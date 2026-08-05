# Optional backend CA certificates

Normally Node.js on Oracle Ubuntu validates HiveMQ Cloud with the operating system CA store, so `MQTT_CA_PATH` should stay empty.

Only place a PEM CA certificate here when your HiveMQ cluster or company policy explicitly requires a custom CA bundle, then set for example:

```env
MQTT_CA_PATH=./certs/hivemq-ca.pem
```

Never commit private keys or client passwords.
