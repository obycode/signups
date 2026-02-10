const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const APP_FILE = path.resolve(__dirname, "..", "..", "app.js");

function noopMiddleware(req, res, next) {
  if (typeof next === "function") {
    next();
  }
}

function createCheckChain() {
  const chain = new Proxy(
    {},
    {
      get(_target, property) {
        if (property === "then") {
          return undefined;
        }
        return () => chain;
      },
    },
  );
  return chain;
}

function createRes() {
  const res = {
    statusCode: 200,
    renderCalls: [],
    redirectCalls: [],
    cookieCalls: [],
    clearCookieCalls: [],
    jsonCalls: [],
    status(code) {
      this.statusCode = code;
      return this;
    },
    render(view, data) {
      this.renderCalls.push({ view, data });
      return this;
    },
    redirect(location) {
      this.redirectCalls.push(location);
      return this;
    },
    cookie(name, value, options) {
      this.cookieCalls.push({ name, value, options });
      return this;
    },
    clearCookie(name, options) {
      this.clearCookieCalls.push({ name, options });
      return this;
    },
    json(body) {
      this.jsonCalls.push(body);
      return this;
    },
  };
  return res;
}

function createReq(overrides = {}) {
  return {
    body: {},
    query: {},
    cookies: {},
    ...overrides,
  };
}

async function flushAsync() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

function loadAppWithMocks(options = {}) {
  const source = fs.readFileSync(APP_FILE, "utf8");

  const state = {
    routes: { get: new Map(), post: new Map(), put: new Map(), delete: new Map() },
    appSets: [],
    listenCalls: [],
    snsPublishes: [],
    sesEmails: [],
    createUserPayloads: [],
    getUserByEmailInputs: [],
    getUserByPhoneInputs: [],
    checkOtpInputs: [],
    getMagicCodeInputs: [],
  };

  const dbOverrides = options.db || {};
  const uuidValue = options.uuid || "11111111-1111-1111-1111-111111111111";
  const jwtSignValue = options.jwtSignValue || "signed-token";

  const dbFunctions = {
    init: async () => {},
    getEvents: async () => [],
    getActiveEvents: async () => [],
    getActiveSignupsForUser: async () => [],
    getInactiveSignupsForUser: async () => [],
    getMagicCodeForUser: async (userId) => {
      state.getMagicCodeInputs.push(userId);
      return "magic-code";
    },
    createUser: async (payload) => {
      state.createUserPayloads.push(payload);
      return { id: 100, login_code: "999999" };
    },
    getUser: async () => null,
    getUserByEmail: async (email) => {
      state.getUserByEmailInputs.push(email);
      return null;
    },
    getUserByPhone: async (phone) => {
      state.getUserByPhoneInputs.push(phone);
      return null;
    },
    getItemsForEvent: async () => [],
    getActiveItemsForEvent: async () => [],
    countItemsForEvent: async () => 0,
    countActiveItemsForEvent: async () => 0,
    countNeededForEvent: async () => 0,
    createEvent: async () => 1,
    getEvent: async () => null,
    updateEvent: async () => {},
    deleteEvent: async () => {},
    activateEvent: async () => {},
    getSignupsForEvent: async () => [],
    getItem: async () => null,
    createSignup: async () => 1,
    getSignup: async () => null,
    getSignupBySubmissionToken: async () => null,
    cancelSignup: async () => {},
    isAdmin: async () => false,
    createItem: async () => 1,
    updateItem: async () => {},
    deleteItem: async () => {},
    hasActiveSignupsForItem: async () => false,
    setItemActive: async () => {},
    createKid: async () => 1,
    getKid: async () => null,
    getKidsForEvent: async () => [],
    getPendingKidsForEvent: async () => [],
    updateKid: async () => {},
    deleteKid: async () => {},
    approveKid: async () => {},
    getShelters: async () => [],
    createShelter: async () => 1,
    setEventShelters: async () => {},
    getSheltersForEvent: async () => [],
    checkUserOTP: async (userId, otp) => {
      state.checkOtpInputs.push({ userId, otp });
      return null;
    },
    healthCheck: async () => {},
  };
  Object.assign(dbFunctions, dbOverrides);

  function createApp() {
    return {
      set(key, value) {
        state.appSets.push({ key, value });
        return this;
      },
      use() {
        return this;
      },
      get(route, ...handlers) {
        state.routes.get.set(route, handlers[handlers.length - 1]);
        return this;
      },
      post(route, ...handlers) {
        state.routes.post.set(route, handlers[handlers.length - 1]);
        return this;
      },
      put(route, ...handlers) {
        state.routes.put.set(route, handlers[handlers.length - 1]);
        return this;
      },
      delete(route, ...handlers) {
        state.routes.delete.set(route, handlers[handlers.length - 1]);
        return this;
      },
      listen(port, host, callback) {
        state.listenCalls.push({ port, host });
        const server = {
          address() {
            return { address: "0.0.0.0", port: Number(port) || 3000 };
          },
        };
        if (typeof callback === "function") {
          setImmediate(() => callback());
        }
        return server;
      },
    };
  }

  const expressFactory = () => createApp();
  expressFactory.static = () => noopMiddleware;
  expressFactory.json = () => noopMiddleware;

  class MockSNSClient {
    async send(command) {
      state.snsPublishes.push(command.input);
      return { MessageId: "sns-message-id" };
    }
  }

  class MockSESClient {
    async send(command) {
      state.sesEmails.push(command.input);
      return { MessageId: "ses-message-id" };
    }
  }

  class MockS3Client {}

  class MockPublishCommand {
    constructor(input) {
      this.input = input;
    }
  }

  class MockSendEmailCommand {
    constructor(input) {
      this.input = input;
    }
  }

  class MockUpload {
    constructor(input) {
      this.input = input;
    }

    async done() {
      return {};
    }
  }

  const sandbox = {
    module: { exports: {} },
    exports: {},
    __dirname: path.dirname(APP_FILE),
    __filename: APP_FILE,
    process,
    Buffer,
    setTimeout,
    clearTimeout,
    setImmediate,
    clearImmediate,
    console: {
      log: () => {},
      error: () => {},
    },
    require: (id) => {
      if (id === "dotenv") {
        return { config: () => {} };
      }
      if (id === "body-parser") {
        return { urlencoded: () => noopMiddleware };
      }
      if (id === "express") {
        return expressFactory;
      }
      if (id === "express-validator") {
        return {
          check: () => createCheckChain(),
          validationResult: (req) => {
            const errors = req.__validationErrors || [];
            return {
              isEmpty: () => errors.length === 0,
              array: () => errors,
            };
          },
        };
      }
      if (id === "validator") {
        return {};
      }
      if (id === "pug") {
        return {
          renderFile: (templatePath, locals) =>
            `<div data-template="${templatePath}">${JSON.stringify(locals || {})}</div>`,
          render: (templateText, locals) =>
            `<span data-template-text="${templateText}">${JSON.stringify(locals || {})}</span>`,
        };
      }
      if (id === "inline-css") {
        return async (html) => html;
      }
      if (id === "@obycode/neoncrm") {
        return { Client: class MockNeonClient {} };
      }
      if (id === "cookie-parser") {
        return () => noopMiddleware;
      }
      if (id === "jsonwebtoken") {
        return {
          sign: () => jwtSignValue,
          verify: () => ({ userID: 1 }),
        };
      }
      if (id === "uuid") {
        return { v4: () => uuidValue };
      }
      if (id === "multer") {
        const multer = () => ({
          single: () => noopMiddleware,
          array: () => noopMiddleware,
          fields: () => noopMiddleware,
        });
        multer.memoryStorage = () => ({});
        return multer;
      }
      if (id === "@aws-sdk/client-sns") {
        return { SNSClient: MockSNSClient, PublishCommand: MockPublishCommand };
      }
      if (id === "@aws-sdk/client-ses") {
        return { SESClient: MockSESClient, SendEmailCommand: MockSendEmailCommand };
      }
      if (id === "@aws-sdk/client-s3") {
        return { S3Client: MockS3Client };
      }
      if (id === "@aws-sdk/lib-storage") {
        return { Upload: MockUpload };
      }
      if (id === "./db") {
        return dbFunctions;
      }
      return require(id);
    },
  };
  sandbox.global = sandbox;

  vm.runInNewContext(source, sandbox, { filename: APP_FILE });

  return { state };
}

module.exports = {
  createReq,
  createRes,
  flushAsync,
  loadAppWithMocks,
};
