// Typed-fragments PHASE 3: the `surql.fn` builtin catalog. Lowering is unit-tested; the LIVE
// sweep runs EVERY catalog entry against a real server with sample args — a builtin name that
// doesn't exist on the target SurrealDB fails here, so the catalog can't drift from reality.
// Entries whose sample is `null` are syntax-verified only (need capabilities/contexts a bare
// RETURN doesn't have: http, fulltext search, field contexts).
import { describe, expect, test } from "bun:test";
import { fn } from "../../src/fn";
import {
  DateTime,
  Duration,
  defineTable,
  RecordId,
  s,
  surql,
} from "../../src/index";
import { select } from "../../src/query";

// --- walk the catalog -------------------------------------------------------------------------

type Leaf = { path: string; call: (...args: unknown[]) => { query: string } };
function leaves(node: unknown, path: string[] = []): Leaf[] {
  const out: Leaf[] = [];
  if (typeof node === "function")
    out.push({ path: path.join("."), call: node as Leaf["call"] });
  if (node !== null && (typeof node === "object" || typeof node === "function"))
    for (const [k, v] of Object.entries(node))
      out.push(...leaves(v, [...path, k]));
  return out;
}
const ALL = leaves(fn);

// --- live-sample args per catalog path (null = skip live; MUST be exhaustive) -----------------

const d = new Duration("1w");
const t = new Date("2026-01-02T03:04:05Z");
const rid = new RecordId("fnc_probe", "one");
const point = surql`(-0.04, 51.55)`;
const point2 = surql`(30.46, -17.86)`;

const SAMPLES: Record<string, unknown[] | null> = {
  "array.append": [[1], 2],
  "array.at": [[1, 2], 0],
  "array.combine": [[1], [2]],
  "array.complement": [[1, 2], [2]],
  "array.concat": [[1], [2]],
  "array.difference": [
    [1, 2],
    [2, 3],
  ],
  "array.distinct": [[1, 1, 2]],
  "array.find_index": [[1, 2], 2],
  "array.first": [[1, 2]],
  "array.flatten": [[[1], [2]]],
  "array.group": [[[1], [1, 2]]],
  "array.insert": [[1, 3], 2, 1],
  "array.intersect": [
    [1, 2],
    [2, 3],
  ],
  "array.is_empty": [[]],
  "array.join": [["a", "b"], ","],
  "array.last": [[1, 2]],
  "array.len": [[1, 2, 3]],
  "array.max": [[1, 9, 2]],
  "array.min": [[1, 9, 2]],
  "array.pop": [[1, 2]],
  "array.prepend": [[2], 1],
  "array.push": [[1], 2],
  "array.range": [1, 4],
  "array.remove": [[1, 2, 3], 1],
  "array.repeat": ["x", 3],
  "array.reverse": [[1, 2]],
  "array.shuffle": [[1, 2, 3]],
  "array.slice": [[1, 2, 3], 1, 2],
  "array.sort.asc": [[3, 1, 2]],
  "array.sort.desc": [[3, 1, 2]],
  "array.union": [[1], [2]],
  count: [true],
  "crypto.md5": ["x"],
  "crypto.sha1": ["x"],
  "crypto.sha256": ["x"],
  "crypto.sha512": ["x"],
  "crypto.argon2.compare": [fn.crypto.argon2.generate("pw"), "pw"],
  "crypto.argon2.generate": ["pw"],
  "crypto.bcrypt.compare": [fn.crypto.bcrypt.generate("pw"), "pw"],
  "crypto.bcrypt.generate": ["pw"],
  "crypto.pbkdf2.compare": [fn.crypto.pbkdf2.generate("pw"), "pw"],
  "crypto.pbkdf2.generate": ["pw"],
  "crypto.scrypt.compare": [fn.crypto.scrypt.generate("pw"), "pw"],
  "crypto.scrypt.generate": ["pw"],
  "duration.days": [d],
  "duration.hours": [d],
  "duration.micros": [d],
  "duration.millis": [d],
  "duration.mins": [d],
  "duration.nanos": [d],
  "duration.secs": [d],
  "duration.weeks": [d],
  "duration.years": [d],
  "duration.from_days": [2],
  "duration.from_hours": [2],
  "duration.from_micros": [2],
  "duration.from_millis": [2],
  "duration.from_mins": [2],
  "duration.from_nanos": [2],
  "duration.from_secs": [2],
  "duration.from_weeks": [2],
  "encoding.base64.encode": [new Uint8Array([104, 105])],
  "encoding.base64.decode": [
    fn.encoding.base64.encode(new Uint8Array([104, 105])),
  ],
  "geo.area": [
    surql`{ type: 'Polygon', coordinates: [[[0.0, 0.0], [0.0, 1.0], [1.0, 1.0], [1.0, 0.0], [0.0, 0.0]]] }`,
  ],
  "geo.bearing": [point, point2],
  "geo.centroid": [
    surql`{ type: 'Polygon', coordinates: [[[0.0, 0.0], [0.0, 1.0], [1.0, 1.0], [1.0, 0.0], [0.0, 0.0]]] }`,
  ],
  "geo.distance": [point, point2],
  "http.head": null,
  "http.get": null,
  "http.put": null,
  "http.post": null,
  "http.patch": null,
  "http.delete": null,
  "math.abs": [-2],
  "math.bottom": [[1, 5, 2], 2],
  "math.ceil": [1.4],
  "math.fixed": [1.4567, 2],
  "math.floor": [1.6],
  "math.interquartile": [[1, 2, 3, 4]],
  "math.ln": [10],
  "math.log": [100, 10],
  "math.log10": [100],
  "math.log2": [8],
  "math.max": [[1, 9]],
  "math.mean": [[1, 2, 3]],
  "math.median": [[1, 2, 3]],
  "math.min": [[1, 9]],
  "math.mode": [[1, 1, 2]],
  "math.percentile": [[1, 2, 3, 4], 50],
  "math.pow": [2, 10],
  "math.product": [[2, 3]],
  "math.round": [1.5],
  "math.sign": [-5],
  "math.sqrt": [9],
  "math.stddev": [[1, 2, 3]],
  "math.sum": [[1, 2, 3]],
  "math.top": [[1, 5, 2], 2],
  "math.variance": [[1, 2, 3]],
  "object.entries": [{ a: 1 }],
  "object.from_entries": [fn.object.entries({ a: 1 })],
  "object.keys": [{ a: 1 }],
  "object.len": [{ a: 1 }],
  "object.values": [{ a: 1 }],
  "parse.email.host": ["a@b.com"],
  "parse.email.user": ["a@b.com"],
  "parse.url.domain": ["https://example.com/x"],
  "parse.url.fragment": ["https://example.com/x#f"],
  "parse.url.host": ["https://example.com/x"],
  "parse.url.path": ["https://example.com/x"],
  "parse.url.port": ["https://example.com:8080/x"],
  "parse.url.query": ["https://example.com/x?a=1"],
  "parse.url.scheme": ["https://example.com/x"],
  rand: [],
  "rand.bool": [],
  "rand.enum": ["a", "b"],
  "rand.float": [1, 2],
  "rand.id": [10],
  "rand.int": [1, 9],
  "rand.string": [8],
  "rand.time": [],
  "rand.ulid": [],
  "rand.uuid": [],
  "rand.uuid.v4": [],
  "rand.uuid.v7": [],
  "record.exists": [rid],
  "record.id": [rid],
  "record.table": [rid],
  "search.score": null,
  "search.highlight": null,
  "search.offsets": null,
  "session.db": [],
  "session.id": [],
  "session.ip": [],
  "session.ns": [],
  "session.origin": [],
  "session.token": [],
  sleep: [new Duration("1ms")],
  "string.concat": ["a", "b"],
  "string.contains": ["abc", "b"],
  "string.ends_with": ["abc", "c"],
  "string.join": [",", "a", "b"],
  "string.len": ["abc"],
  "string.lowercase": ["ABC"],
  "string.matches": ["abc", "a.c"],
  "string.repeat": ["ab", 2],
  "string.replace": ["abc", "b", "x"],
  "string.reverse": ["abc"],
  "string.slice": ["abcdef", 1, 3],
  "string.slug": ["Hello World"],
  "string.split": ["a,b", ","],
  "string.starts_with": ["abc", "a"],
  "string.trim": ["  x  "],
  "string.uppercase": ["abc"],
  "string.words": ["a b c"],
  "string.is_alphanum": ["abc123"],
  "string.is_alpha": ["abc"],
  "string.is_ascii": ["abc"],
  "string.is_datetime": ["2015-09-21 15:03:00", "%Y-%m-%d %H:%M:%S"],
  "string.is_domain": ["example.com"],
  "string.is_email": ["a@b.com"],
  "string.is_hexadecimal": ["ff00"],
  "string.is_ip": ["127.0.0.1"],
  "string.is_ipv4": ["127.0.0.1"],
  "string.is_ipv6": ["::1"],
  "string.is_latitude": ["51.5"],
  "string.is_longitude": ["-0.1"],
  "string.is_numeric": ["1234"],
  "string.is_semver": ["1.2.3"],
  "string.is_url": ["https://example.com"],
  "string.is_uuid": ["018a6680-5b34-7f00-8000-000000000000"],
  "time.day": [t],
  "time.floor": [t, d],
  "time.format": [t, "%Y-%m-%d"],
  "time.group": [t, "day"],
  "time.hour": [t],
  "time.max": [[t, new Date()]],
  "time.min": [[t, new Date()]],
  "time.minute": [t],
  "time.month": [t],
  "time.nano": [t],
  "time.now": [],
  "time.round": [t, d],
  "time.second": [t],
  "time.timezone": [],
  "time.unix": [t],
  "time.wday": [t],
  "time.week": [t],
  "time.yday": [t],
  "time.year": [t],
  "time.from_micros": [1000000],
  "time.from_millis": [1000],
  "time.from_nanos": [1000000000],
  "time.from_secs": [1],
  "time.from_unix": [1],
  "type.bool": ["true"],
  "type.datetime": ["2026-01-02T03:04:05Z"],
  "type.decimal": ["1.5"],
  "type.duration": ["1h"],
  "type.field": null,
  "type.fields": null,
  "type.float": ["1.5"],
  "type.int": ["3"],
  "type.number": ["3"],
  "type.point": [[-0.04, 51.55]],
  "type.record": ["fnc_probe:one"],
  "type.string": [3],
  "type.table": ["fnc_probe"],
  "type.uuid": ["018a6680-5b34-7f00-8000-000000000000"],
  "type.is_array": [[1]],
  "type.is_bool": [true],
  "type.is_datetime": [t],
  "type.is_decimal": [1],
  "type.is_duration": [d],
  "type.is_float": [1.5],
  "type.is_int": [1],
  "type.is_none": [1],
  "type.is_null": [1],
  "type.is_number": [1],
  "type.is_object": [{ a: 1 }],
  "type.is_record": [rid],
  "type.is_string": ["x"],
  "type.is_uuid": ["x"],
  "vector.add": [
    [1, 2],
    [3, 4],
  ],
  "vector.angle": [
    [1, 0],
    [0, 1],
  ],
  "vector.cross": [
    [1, 0, 0],
    [0, 1, 0],
  ],
  "vector.divide": [
    [4, 6],
    [2, 3],
  ],
  "vector.dot": [
    [1, 2],
    [3, 4],
  ],
  "vector.magnitude": [[3, 4]],
  "vector.multiply": [
    [1, 2],
    [3, 4],
  ],
  "vector.normalize": [[3, 4]],
  "vector.subtract": [
    [3, 4],
    [1, 2],
  ],
  "vector.distance.chebyshev": [
    [1, 2],
    [3, 4],
  ],
  "vector.distance.euclidean": [
    [1, 2],
    [3, 4],
  ],
  "vector.distance.hamming": [
    [1, 2],
    [1, 4],
  ],
  "vector.distance.manhattan": [
    [1, 2],
    [3, 4],
  ],
  "vector.similarity.cosine": [
    [1, 2],
    [3, 4],
  ],
  "vector.similarity.jaccard": [
    [1, 2],
    [2, 3],
  ],
  "vector.similarity.pearson": [
    [1, 2, 3],
    [1, 2, 4],
  ],
};

describe("catalog shape", () => {
  test("every catalog entry has a live sample (or an explicit null skip)", () => {
    const missing = ALL.filter((l) => !(l.path in SAMPLES)).map((l) => l.path);
    expect(missing).toEqual([]);
    const stale = Object.keys(SAMPLES).filter(
      (p) => !ALL.some((l) => l.path === p),
    );
    expect(stale).toEqual([]);
  });

  test("calls lower to fn(name)(args): literals bind, refs/fragments splice", () => {
    const q = fn.string.len("abc");
    expect(q.query).toMatch(/^string::len\(\$r\d+\)$/);
    expect(Object.values(q.bindings ?? {})).toEqual(["abc"]);

    const T = defineTable("fnc_t", { name: s.string() });
    const sub = select(T).where((u) => u.name.length().gt(1));
    const composed = fn.array.len(sub);
    expect(composed.query).toMatch(
      /^array::len\(\(SELECT \* FROM fnc_t WHERE string::len\(name\) > \$sub__\d+_b0\)\)$/,
    );
  });

  test("fn results interpolate into surql templates and builder slots", () => {
    const q = surql`RETURN ${fn.string.uppercase("hi")}`;
    expect(q.query).toMatch(/^RETURN string::uppercase\(\$r\d+\)$/);
  });
});

// --- live sweep (SURREAL_URL-gated) --------------------------------------------------------------
const URL = process.env.SURREAL_URL;

describe.skipIf(!URL)("catalog live sweep", () => {
  test("every sampled builtin runs on the target server", async () => {
    const { Surreal } = await import("surrealdb");
    const c = new Surreal();
    await c.connect(URL as string);
    await c.signin({ username: "root", password: "root" });
    await c.use({ namespace: "fnc", database: "fnc" });
    // record:: probes need the table to exist.
    await c.query("DEFINE TABLE OVERWRITE fnc_probe SCHEMALESS");

    const failures: string[] = [];
    for (const leaf of ALL) {
      const sample = SAMPLES[leaf.path];
      if (sample === null || sample === undefined) continue;
      try {
        const frag = leaf.call(...sample);
        const q = surql`RETURN ${frag}`;
        await c.query(q.query, { ...q.bindings });
      } catch (err) {
        failures.push(`${leaf.path}: ${(err as Error).message}`);
      }
    }
    await c.close();
    expect(failures).toEqual([]);
  }, 120_000);
});
