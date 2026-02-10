const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const DB_FILE = path.resolve(__dirname, "..", "db.js");

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function loadDbWithMocks(options = {}) {
  const state = {
    parseInputs: [],
    poolConfigs: [],
    clientQueries: [],
    poolQueries: [],
    released: false,
  };

  const parseImpl =
    options.parseImpl ||
    (() => {
      return {};
    });
  const clientQueryImpl =
    options.clientQueryImpl ||
    (async (sql) => {
      state.clientQueries.push(sql);
      if (sql.includes("SELECT id, code") && sql.includes("FROM shelters")) {
        return { rows: [] };
      }
      if (sql.includes("SELECT EXISTS")) {
        return { rows: [{ exists: true }] };
      }
      return { rows: [{ exists: true }] };
    });
  const poolQueryImpl =
    options.poolQueryImpl ||
    (async (sql) => {
      state.poolQueries.push(sql);
      return { rows: [{ ok: 1 }] };
    });

  const client = {
    query: (sql, params) => clientQueryImpl(sql, params, state),
    release: () => {
      state.released = true;
    },
  };

  class MockPool {
    constructor(config) {
      state.poolConfigs.push(config);
    }

    async connect() {
      return client;
    }

    async query(sql, params) {
      return poolQueryImpl(sql, params, state);
    }
  }

  const source = fs.readFileSync(DB_FILE, "utf8");
  const module = { exports: {} };
  const sandbox = {
    module,
    exports: module.exports,
    __dirname: path.dirname(DB_FILE),
    __filename: DB_FILE,
    process,
    console,
    Buffer,
    setTimeout,
    clearTimeout,
    require: (id) => {
      if (id === "dotenv") {
        return { config: () => {} };
      }
      if (id === "pg") {
        return { Pool: MockPool };
      }
      if (id === "pg-connection-string") {
        return {
          parse: (value) => {
            state.parseInputs.push(value);
            return parseImpl(value, state);
          },
        };
      }
      if (id === "pug") {
        return {};
      }
      if (id === "entities") {
        return { decode: (value) => value };
      }
      return require(id);
    },
  };
  sandbox.global = sandbox;

  vm.runInNewContext(source, sandbox, { filename: DB_FILE });

  return { db: module.exports, state };
}

test("init runs table checks sequentially and releases client", async () => {
  let inFlight = 0;
  let maxInFlight = 0;

  const { db, state } = loadDbWithMocks({
    clientQueryImpl: async (sql, _params) => {
      state.clientQueries.push(sql);
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await delay(2);
      inFlight -= 1;
      return { rows: [{ exists: true }] };
    },
  });

  await db.init();

  assert.equal(maxInFlight, 1);
  assert.ok(state.clientQueries.length >= 9);
  assert.equal(state.released, true);
});

test("init rethrows errors and still releases client", async () => {
  const { db, state } = loadDbWithMocks({
    clientQueryImpl: async () => {
      throw new Error("db init failed");
    },
  });

  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    await assert.rejects(() => db.init(), /db init failed/);
    assert.equal(state.released, true);
  } finally {
    console.error = originalConsoleError;
  }
});

test("healthCheck fails before init", async () => {
  const { db } = loadDbWithMocks();
  await assert.rejects(
    () => db.healthCheck(),
    /Database pool is not initialized/,
  );
});

test("healthCheck runs SELECT 1 after init", async () => {
  const { db, state } = loadDbWithMocks();
  await db.init();
  await db.healthCheck();
  assert.equal(state.poolQueries[state.poolQueries.length - 1], "SELECT 1");
});

test("init applies SSL config when NODE_ENV is set", async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousDatabaseUrl = process.env.DATABASE_URL;
  process.env.NODE_ENV = "production";
  process.env.DATABASE_URL = "postgres://example";

  try {
    const { db, state } = loadDbWithMocks({
      parseImpl: () => ({ host: "db.local" }),
    });

    await db.init();

    assert.equal(state.parseInputs[0], "postgres://example");
    assert.equal(state.poolConfigs[0].ssl.rejectUnauthorized, false);
  } finally {
    if (previousNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = previousNodeEnv;
    }

    if (previousDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = previousDatabaseUrl;
    }
  }
});

test("getKidsForEvent maps shelter ids to spreadsheet-style labels", async () => {
  const { db } = loadDbWithMocks({
    poolQueryImpl: async () => ({
      rows: [
        { id: 1, shelter: 1, shelter_id: "A", shelter_name: "Shelter One" },
        { id: 2, shelter: 26, shelter_id: "Z", shelter_name: "Shelter Two" },
        { id: 3, shelter: 27, shelter_id: null, shelter_name: "Shelter Three" },
      ],
    }),
  });

  await db.init();
  const kids = await db.getKidsForEvent(99);

  assert.equal(kids.length, 3);
  assert.equal(kids[0].shelter_id, "A");
  assert.equal(kids[1].shelter_id, "Z");
  assert.equal(kids[2].shelter_id, "AA");
});

test("createShelter stores explicit next available shelter code", async () => {
  let insertParams = null;
  const { db } = loadDbWithMocks({
    poolQueryImpl: async (sql, params) => {
      if (sql.includes("SELECT code")) {
        return {
          rows: [{ code: "A" }, { code: "B" }, { code: "D" }, { code: "I" }],
        };
      }
      if (sql.includes("INSERT INTO shelters")) {
        insertParams = params;
        return {
          rows: [{ id: 99, name: params[0], code: params[1] }],
        };
      }
      return { rows: [{ ok: 1 }] };
    },
  });

  await db.init();
  const shelter = await db.createShelter("New Shelter");

  assert.equal(insertParams[0], "New Shelter");
  assert.equal(insertParams[1], "C");
  assert.equal(shelter.id, 99);
  assert.equal(shelter.code, "C");
});
