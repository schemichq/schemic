import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { DateTime, RecordId, Uuid } from "surrealdb";
import { sz, defineTable } from "../../src/pure";

const UUID = "0190b6e0-1234-7890-abcd-ef0123456789";

describe("native codecs (schema-level)", () => {
  test("datetime: DateTime <-> Date", () => {
    const schema = sz.datetime().schema;
    const decoded = z.decode(
      schema,
      new DateTime(new Date("2020-01-01T00:00:00.000Z")),
    );
    expect(decoded).toBeInstanceOf(Date);
    expect((decoded as Date).toISOString()).toBe("2020-01-01T00:00:00.000Z");

    const encoded = z.encode(schema, new Date("2020-01-01T00:00:00.000Z"));
    expect(encoded).toBeInstanceOf(DateTime);
  });

  test("uuid: Uuid <-> string", () => {
    const schema = sz.uuid().schema;
    const decoded = z.decode(schema, new Uuid(UUID));
    expect(decoded).toBe(UUID);

    const encoded = z.encode(schema, UUID);
    expect(encoded).toBeInstanceOf(Uuid);
    expect((encoded as Uuid).toString()).toBe(UUID);
  });

  test("uuid: encoding an invalid string fails", () => {
    expect(() => z.encode(sz.uuid().schema, "not-a-uuid")).toThrow();
  });

  test("bytes: Uint8Array passes through, ArrayBuffer is normalized", () => {
    const schema = sz.bytes().schema;
    const u8 = new Uint8Array([1, 2, 3]);
    expect(z.decode(schema, u8)).toBeInstanceOf(Uint8Array);

    const fromBuffer = z.decode(schema, u8.buffer);
    expect(fromBuffer).toBeInstanceOf(Uint8Array);
    expect(Array.from(fromBuffer as Uint8Array)).toEqual([1, 2, 3]);
  });

  test("recordId is identity (no codec), but enforces the table", () => {
    const schema = sz.recordId("user").schema;
    const rid = new RecordId("user", "x");
    expect(schema.safeParse(rid).success).toBe(true);
    expect(schema.safeParse(new RecordId("post", "x")).success).toBe(false);
  });
});

describe("field-level codec (SField.decode / encode)", () => {
  test("datetime: decode(DateTime) -> Date, encode(Date) -> DateTime", () => {
    const f = sz.datetime();
    const dt = new DateTime(new Date("2020-01-01T00:00:00.000Z"));
    const decoded = f.decode(dt);
    expect(decoded).toBeInstanceOf(Date);
    expect(decoded.toISOString()).toBe("2020-01-01T00:00:00.000Z");

    const encoded = f.encode(new Date("2020-01-01T00:00:00.000Z"));
    expect(encoded).toBeInstanceOf(DateTime);
  });

  test("uuid: decode(Uuid) -> string, encode(string) -> Uuid", () => {
    const f = sz.uuid();
    expect(f.decode(new Uuid(UUID))).toBe(UUID);
    const encoded = f.encode(UUID);
    expect(encoded).toBeInstanceOf(Uuid);
    expect((encoded as Uuid).toString()).toBe(UUID);
  });

  test("encode throws on an invalid value; safeEncode reports it", () => {
    expect(() => sz.uuid().encode("not-a-uuid")).toThrow();
    expect(sz.uuid().safeEncode("not-a-uuid").success).toBe(false);
    expect(sz.uuid().safeEncode(UUID).success).toBe(true);
  });

  test("async + deprecated parse alias", async () => {
    const f = sz.datetime();
    const decoded = await f.decodeAsync(
      new DateTime(new Date("2020-01-01T00:00:00.000Z")),
    );
    expect(decoded).toBeInstanceOf(Date);
    expect(await f.encodeAsync(new Date())).toBeInstanceOf(DateTime);
    const safe = await f.safeEncodeAsync(new Date());
    expect(safe.success).toBe(true);
    // `parse` runs the decode direction (deprecated alias).
    expect(
      f.parse(new DateTime(new Date("2020-01-01T00:00:00.000Z"))),
    ).toBeInstanceOf(Date);
    expect(f.safeParse(new DateTime(new Date())).success).toBe(true);
  });
});

describe("table decode/encode", () => {
  const T = defineTable("t", {
    id: z.string(),
    when: sz.datetime(),
    tag: sz.uuid(),
    data: sz.bytes(),
  });

  test("decode: wire row -> app object", () => {
    const row = {
      id: new RecordId("t", "1"),
      when: new DateTime(new Date("2021-06-01T12:00:00.000Z")),
      tag: new Uuid(UUID),
      data: new Uint8Array([9]).buffer,
    };
    const app = T.decode(row);
    expect(app.id).toBeInstanceOf(RecordId);
    expect(app.when).toBeInstanceOf(Date);
    expect(app.tag).toBe(UUID);
    expect(app.data).toBeInstanceOf(Uint8Array);
  });

  test("encode: app object -> wire row", () => {
    const wire = T.encode({
      id: new RecordId("t", "1"),
      when: new Date("2021-06-01T12:00:00.000Z"),
      tag: UUID,
      data: new Uint8Array([9]),
    });
    expect(wire.when).toBeInstanceOf(DateTime);
    expect(wire.tag).toBeInstanceOf(Uuid);
  });

  test("safeDecode reports failure without throwing", () => {
    const bad = T.safeDecode({
      id: new RecordId("t", "1"),
      when: "nope",
      tag: 1,
      data: 2,
    });
    expect(bad.success).toBe(false);
  });

  test("safeEncode validates the app side", () => {
    const ok = T.safeEncode({
      id: new RecordId("t", "1"),
      when: new Date(),
      tag: UUID,
      data: new Uint8Array([1]),
    });
    expect(ok.success).toBe(true);

    const bad = T.safeEncode({
      id: new RecordId("t", "1"),
      // @ts-expect-error - `when` must be a Date on the app side
      when: 123,
      tag: UUID,
      data: new Uint8Array(),
    });
    expect(bad.success).toBe(false);
  });

  test("async variants resolve", async () => {
    const row = {
      id: new RecordId("t", "1"),
      when: new DateTime(new Date()),
      tag: new Uuid(UUID),
      data: new Uint8Array([1]),
    };
    const app = await T.decodeAsync(row);
    expect(app.when).toBeInstanceOf(Date);
    const safe = await T.safeDecodeAsync(row);
    expect(safe.success).toBe(true);

    const wire = await T.encodeAsync({
      id: new RecordId("t", "1"),
      when: new Date(),
      tag: UUID,
      data: new Uint8Array([1]),
    });
    expect(wire.when).toBeInstanceOf(DateTime);
    const safeWire = await T.safeEncodeAsync({
      id: new RecordId("t", "1"),
      when: new Date(),
      tag: UUID,
      data: new Uint8Array([1]),
    });
    expect(safeWire.success).toBe(true);
  });
});
