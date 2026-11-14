 
# 🧱 Étape 1 — Root CA (offline uniquement)

génération d'un Certificat CA auto-signé (10 ans)

```
openssl req -x509 -new -nodes \
  -key rootCA.key \
  -sha256 -days 3650 \
  -out rootCA.crt \
  -subj "/CN=MyApp Private CA/O=MyOrg"
```
⚠️ **Attention** — Cette clé root doit être stockée hors ligne dans un endroit sécurisé (HSM, coffre-fort cryptographique, ou environnement air-gapped).

# 🔐 Étape 2 — Créer une clé Intermediate CA

clé Intermediate CA signera tes Raspberry Pi

# Créer le fichier de config pour l'intermédiaire
cat > intermediate.cnf << EOF
[req]
distinguished_name = req_distinguished_name
x509_extensions = v3_intermediate_ca
prompt = no

[req_distinguished_name]
CN = MyApp Intermediate CA
O  = MyOrg

[v3_intermediate_ca]
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid:always,issuer
basicConstraints = critical, CA:TRUE, pathlen:0   # ← manquant chez toi
keyUsage = critical, digitalSignature, cRLSign, keyCertSign
EOF


# clé intermediate
openssl genrsa -out intermediate.key 4096

# CSR intermediate
openssl req -new -key intermediate.key \
  -out intermediate.csr \
  -config intermediate.cnf

# signer avec Root CA (offline)
openssl x509 -req -in intermediate.csr \
  -CA rootCA.crt -CAkey rootCA.key \
  -CAcreateserial -out intermediate.crt \
  -days 1825 -sha256 \
  -extfile intermediate.cnf -extensions v3_intermediate_ca

⚠️ tu ranges la root définitivement
tu n’utilises plus jamais rootCA.key

# ⚙️ Étape 3 — Générer un certificat par Raspberry Pi

Utiliser un SAN avec l'IP et un hostname interne fictif (Caddy en a besoin) :

#!/bin/bash
# this script must be executed as root

#Pour chaque Pi (adapte l'IP)

PI_IP="192.168.1.25"
PI_NAME="pi-dev-1.local"

# Clé + CSR
openssl genrsa -out ${PI_NAME}.key 2048
openssl req -new -key ${PI_NAME}.key \
  -out ${PI_NAME}.csr \
  -subj "/CN=${PI_NAME}/O=MyOrg"

# Extension SAN avec IP et hostname fictif
cat > ${PI_NAME}.ext <<EOF
authorityKeyIdentifier=keyid,issuer
basicConstraints=CA:FALSE
keyUsage=digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
subjectAltName=IP:${PI_IP},DNS:${PI_NAME}
EOF


👉 Ensuite :

tu ranges la root définitivement
tu n’utilises plus jamais rootCA.key
⚙️ Étape 3 — Signer tes Raspberry Pi (avec l’intermediate)

Tu modifies juste ça :

openssl x509 -req -in ${PI_NAME}.csr \
  -CA intermediate.crt -CAkey intermediate.key \
  -CAcreateserial -out ${PI_NAME}.crt \
  -days 825 -sha256 -extfile ${PI_NAME}.ext

👉 Résultat :

si intermediate.key fuit → tu peux la révoquer
la Root reste intacte

il faut mettre un fichier config a part pour faire fonctionner le helper auto connect pour watch tower
cat /home/clv/.docker/config.json

{
"credsStore": "ecr-login"
 }