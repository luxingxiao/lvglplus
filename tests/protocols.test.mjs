// SPDX-License-Identifier: Apache-2.0
import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import dgram from "node:dgram";
import { loadProject } from "../packages/cli/dist/project.js";
import { ProtocolAdapter, mqttPacket } from "../packages/cli/dist/protocols.js";
const ir = (await loadProject("examples/vehicle")).ir;
async function eventually(check) {
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) {
    const r = check();
    if (r) return r;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw Error("Timed out");
}
async function server(handler) {
  const s = net.createServer(handler);
  await new Promise((r) => s.listen(0, "127.0.0.1", r));
  return s;
}
const base = {
  name: "test",
  host: "127.0.0.1",
  mappings: { speed: "vehicle.speed" },
};
test("TCP JSON handles fragmented frames, invalid data and bounded queue", async () => {
  let peer;
  const s = await server((socket) => {
    peer = socket;
    socket.write('{"speed":');
    setTimeout(() => socket.write("42}\n"), 5);
  });
  const a = new ProtocolAdapter(
    { ...base, kind: "tcp-json", port: s.address().port },
    ir,
  );
  try {
    a.start();
    let events = [];
    await eventually(() => {
      events.push(...a.drain());
      return events.length;
    });
    assert.equal(events[0].value, 42);
    peer.write('{"speed":"bad"}\n');
    await eventually(() => a.stats.errors > 0);
    assert.equal(a.drain()[0].quality, "invalid");
    peer.write('{"speed":12}\n'.repeat(400));
    await eventually(() => a.stats.overflow > 0);
    assert(a.drain().length <= 256);
  } finally {
    a.stop();
    s.close();
  }
});
test("UDP JSON receives actual datagrams", async () => {
  const probe = dgram.createSocket("udp4");
  await new Promise((r) => probe.bind(0, "127.0.0.1", r));
  const port = probe.address().port;
  await new Promise((r) => probe.close(r));
  let up = false;
  const a = new ProtocolAdapter(
      { ...base, kind: "udp-json", port },
      ir,
      (ok) => (up = ok),
    ),
    sender = dgram.createSocket("udp4");
  try {
    a.start();
    await eventually(() => up);
    sender.send(Buffer.from('{"speed":33}'), port, "127.0.0.1");
    let events;
    await eventually(() => {
      events = a.drain();
      return events.length;
    });
    assert.equal(events[0].value, 33);
  } finally {
    a.stop();
    sender.close();
  }
});
test("Modbus TCP validates MBAP and decodes signed/scaled register values", async () => {
  const s = await server((socket) =>
    socket.on("data", (request) => {
      const reply = Buffer.alloc(13);
      request.copy(reply, 0, 0, 4);
      reply.writeUInt16BE(7, 4);
      reply[6] = 1;
      reply[7] = 3;
      reply[8] = 4;
      reply.writeInt16BE(-125, 9);
      reply.writeUInt16BE(430, 11);
      socket.write(reply);
    }),
  );
  const a = new ProtocolAdapter(
    {
      ...base,
      kind: "modbus-tcp",
      port: s.address().port,
      unit: 1,
      address: 0,
      count: 2,
      pollMs: 100,
      registers: {
        temp: { offset: 0, type: "int16", factor: 0.1 },
        speed: { offset: 1, type: "uint16", factor: 0.1 },
      },
      mappings: { temp: "motor.temperature", speed: "vehicle.speed" },
    },
    ir,
  );
  try {
    a.start();
    let values;
    await eventually(() => {
      values = a.drain();
      return values.length;
    });
    assert.equal(
      values.find((v) => v.signal === "motor.temperature").value,
      -12.5,
    );
    assert.equal(values.find((v) => v.signal === "vehicle.speed").value, 43);
  } finally {
    a.stop();
    s.close();
  }
});
test("MQTT connects/subscribes and decodes fragmented QoS 0 publish", async () => {
  let subscribed = false;
  const s = await server((socket) =>
    socket.on("data", (bytes) => {
      if (bytes[0] === 0x10) socket.write(Buffer.from([0x20, 2, 0, 0]));
      else if (bytes[0] === 0x82) {
        subscribed = true;
        const topic = Buffer.from("vehicle"),
          h = Buffer.from([0, topic.length]),
          payload = mqttPacket(
            0x30,
            Buffer.concat([h, topic, Buffer.from('{"speed":71}')]),
          );
        socket.write(Buffer.from([0x90, 3, 0, 1, 0]));
        socket.write(payload.subarray(0, 3));
        setTimeout(() => socket.write(payload.subarray(3)), 5);
      }
    }),
  );
  const a = new ProtocolAdapter(
    { ...base, kind: "mqtt", port: s.address().port, topic: "vehicle" },
    ir,
  );
  try {
    a.start();
    let values;
    await eventually(() => {
      values = a.drain();
      return values.length;
    });
    assert(subscribed);
    assert.equal(values[0].value, 71);
  } finally {
    a.stop();
    s.close();
  }
});
