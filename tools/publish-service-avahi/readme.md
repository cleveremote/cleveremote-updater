sudo hostnamectl set-hostname zjzza6di
sudo sed -i 's/127.0.1.1.*/127.0.1.1\tzjzza6di/' /etc/hosts
sudo systemctl restart avahi-daemon

sudo tee /etc/avahi/services/https.service >/dev/null <<'EOF'
<?xml version="1.0" standalone='no'?>
<!DOCTYPE service-group SYSTEM "avahi-service.dtd">
<service-group>
  <name replace-wildcards="yes">%h</name>
  <service>
    <type>_https._tcp</type>
    <port>443</port>
  </service>
</service-group>
EOF
sudo systemctl restart avahi-daemon