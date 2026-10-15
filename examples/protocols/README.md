# Protocol adapters

Copy a vehicle project with `lvglplus init`, replace its `sources.json` with this file and select an adapter in Studio. Change host/port/device values explicitly for your deployment. It uses the same vehicle domain model and UI unchanged. No adapter connects until selected.

TCP input example: `{"vehicle":{"speed":42},"battery":{"soc":80}}` followed by LF. UDP/serial/MQTT use their corresponding mapped JSON fields. For a local TCP sender run `node tools/telemetry.mjs`, then select **telemetry**. Modbus uses read-only Function 03; it does not send write requests. MQTT implements an unauthenticated or TLS-secured QoS 0 subscriber, not a general broker client.
