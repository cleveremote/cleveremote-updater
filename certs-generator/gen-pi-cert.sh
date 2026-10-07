#!/bin/bash
# this script must be executed as root
# Génère une clé + CSR + extension SAN pour ce Raspberry Pi
# en récupérant automatiquement le hostname.
#
# Layout :
#   <script_dir>/                    ← racine du script
#     ├── intermediate.crt           (entrée — gardé après signature)
#     ├── intermediate.key           (entrée — détruit après signature)
#     └── certs/                     ← sortie pour Caddy
#         ├── server.key             (clé privée du Pi)
#         └── server.fullchain.crt   (cert Pi + intermediate)
#
# Le SAN ne contient que le hostname (DNS) — pas l'IP — pour rester
# valide quel que soit le réseau local sur lequel le Pi est branché.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CERT_DIR="${SCRIPT_DIR}/certs"
INTERMEDIATE_CRT="${CERT_DIR}/intermediate.crt"
INTERMEDIATE_KEY="${CERT_DIR}/intermediate.key"
DAYS_VALID=397

# --- Hostname ---------------------------------------------------------------
HOSTNAME_SHORT="$(hostname -s)"
PI_NAME="${HOSTNAME_SHORT}.local"

echo "Hostname    : ${PI_NAME}"
echo "Script dir  : ${SCRIPT_DIR}"
echo "Cert dir    : ${CERT_DIR}"

# --- Vérification de l'Intermediate CA --------------------------------------
if [ ! -f "${INTERMEDIATE_CRT}" ] || [ ! -f "${INTERMEDIATE_KEY}" ]; then
  echo "Erreur : Intermediate CA introuvable." >&2
  echo "  Attendu : ${INTERMEDIATE_CRT}" >&2
  echo "            ${INTERMEDIATE_KEY}" >&2
  exit 1
fi

# --- Préparation du dossier de sortie --------------------------------------
mkdir -p "${CERT_DIR}"
chmod 755 "${CERT_DIR}"

KEY_FILE="${CERT_DIR}/server.key"
CSR_FILE="${CERT_DIR}/server.csr"
EXT_FILE="${CERT_DIR}/server.ext"
CRT_FILE="${CERT_DIR}/server.crt"
FULLCHAIN_FILE="${CERT_DIR}/server.fullchain.crt"

# --- Génération clé + CSR + extension --------------------------------------
openssl genrsa -out "${KEY_FILE}" 2048
chmod 600 "${KEY_FILE}"

openssl req -new -key "${KEY_FILE}" \
  -out "${CSR_FILE}" \
  -subj "/CN=${PI_NAME}/O=MyOrg"

cat > "${EXT_FILE}" <<EOF
authorityKeyIdentifier=keyid,issuer
basicConstraints=CA:FALSE
keyUsage=digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
subjectAltName=DNS:${PI_NAME}
EOF

# --- Signature par l'Intermediate CA ---------------------------------------
openssl x509 -req -in "${CSR_FILE}" \
  -CA "${INTERMEDIATE_CRT}" -CAkey "${INTERMEDIATE_KEY}" \
  -CAcreateserial -out "${CRT_FILE}" \
  -days "${DAYS_VALID}" -sha256 -extfile "${EXT_FILE}"

chmod 644 "${CRT_FILE}"

# --- Génération du fullchain (cert Pi + intermediate) ---------------------
# C'est ce fichier qu'on donne à Caddy : il contient la chaîne complète à
# présenter aux clients pendant le handshake TLS.
cat "${CRT_FILE}" "${INTERMEDIATE_CRT}" > "${FULLCHAIN_FILE}"
chmod 644 "${FULLCHAIN_FILE}"

# --- Nettoyage --------------------------------------------------------------
# Suppression des fichiers jetables après une signature réussie :
#   - .csr        : demande de signature, plus utile
#   - .ext        : extensions, déjà gravées dans le .crt
#   - .crt (bare) : redondant avec le fullchain
#   - .srl        : numéro de série généré par -CAcreateserial
#   - intermediate.key : NE DOIT PAS rester sur le Pi (sécurité)
#
# On utilise `shred` quand disponible pour effacer la clé privée de
# l'intermediate de manière irrécupérable, sinon on retombe sur `rm -f`.

secure_delete() {
  local f="$1"
  [ -f "$f" ] || return 0
  if command -v shred >/dev/null 2>&1; then
    shred -u -n 3 "$f" 2>/dev/null || rm -f "$f"
  else
    rm -f "$f"
  fi
}

rm -f "${CSR_FILE}" "${EXT_FILE}" "${CRT_FILE}" "${SCRIPT_DIR}/intermediate.srl"
secure_delete "${INTERMEDIATE_KEY}"

echo
echo "Nettoyage effectué :"
echo "  - supprimé : ${CSR_FILE}"
echo "  - supprimé : ${EXT_FILE}"
echo "  - supprimé : ${CRT_FILE}"
echo "  - supprimé : ${SCRIPT_DIR}/intermediate.srl"
echo "  - effacé   : ${INTERMEDIATE_KEY} (clé Intermediate CA)"
echo
echo "Fichiers conservés :"
echo "  ${CERT_DIR}/"
echo "    ├── server.key             (clé privée du Pi, CN=${PI_NAME})"
echo "    └── server.fullchain.crt   (cert + intermediate)"
echo "  ${SCRIPT_DIR}/"
echo "    └── intermediate.crt       (cert Intermediate CA)"

# --- Déploiement pour Caddy --------------------------------------------------
# Caddy tourne sous l'utilisateur système "caddy", qui ne peut pas traverser
# le home directory (700). On copie donc les certs dans /etc/caddy/certs,
# lisible par ce user, puis on recharge le service.
CADDY_CERT_DIR="/etc/caddy/certs"

if id caddy >/dev/null 2>&1 && [ -d /etc/caddy ]; then
  echo
  echo "Déploiement vers ${CADDY_CERT_DIR} ..."
  mkdir -p "${CADDY_CERT_DIR}"
  cp "${KEY_FILE}" "${FULLCHAIN_FILE}" "${CADDY_CERT_DIR}/"
  chown caddy:caddy "${CADDY_CERT_DIR}/server.key" "${CADDY_CERT_DIR}/server.fullchain.crt"
  chmod 600 "${CADDY_CERT_DIR}/server.key"
  chmod 644 "${CADDY_CERT_DIR}/server.fullchain.crt"
  echo "  ${CADDY_CERT_DIR}/server.key"
  echo "  ${CADDY_CERT_DIR}/server.fullchain.crt"

  if systemctl is-active --quiet caddy.service; then
    systemctl reload caddy.service
    echo "  caddy.service rechargé"
  fi
else
  echo
  echo "Note : utilisateur/service caddy introuvable, déploiement vers ${CADDY_CERT_DIR} ignoré."
fi
