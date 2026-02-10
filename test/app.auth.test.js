const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createReq,
  createRes,
  flushAsync,
  loadAppWithMocks,
} = require("./helpers/app-harness");

test("POST /login with unknown email renders register and sends nothing", async () => {
  const { state } = loadAppWithMocks({
    db: {
      getUserByEmail: async () => null,
    },
  });

  const handler = state.routes.post.get("/login");
  assert.ok(handler);

  const req = createReq({
    body: { identifier: "nobody@example.com", item: "7" },
  });
  const res = createRes();

  await handler(req, res);

  assert.equal(res.renderCalls.length, 1);
  assert.equal(res.renderCalls[0].view, "register");
  assert.equal(state.sesEmails.length, 0);
  assert.equal(state.snsPublishes.length, 0);
});

test("POST /login with existing email renders link-sent and queues email only", async () => {
  const { state } = loadAppWithMocks({
    db: {
      getUserByEmail: async () => ({
        id: 42,
        email: "member@example.com",
        magic_code: "abc123",
        login_code: "334455",
      }),
    },
  });

  const handler = state.routes.post.get("/login");
  const req = createReq({
    body: { identifier: "member@example.com", item: "5" },
  });
  const res = createRes();

  await handler(req, res);
  await flushAsync();

  assert.equal(res.renderCalls[0].view, "link-sent");
  assert.equal(res.renderCalls[0].data.user_id, 42);
  assert.equal(state.sesEmails.length, 1);
  assert.equal(state.snsPublishes.length, 0);
});

test("POST /login with existing phone renders link-sent and queues SMS only", async () => {
  const { state } = loadAppWithMocks({
    db: {
      getUserByPhone: async () => ({
        id: 84,
        phone: "4105551212",
        login_code: "112233",
      }),
    },
  });

  const handler = state.routes.post.get("/login");
  const req = createReq({
    body: { identifier: "4105551212", item: "3" },
  });
  const res = createRes();

  await handler(req, res);
  await flushAsync();

  assert.equal(res.renderCalls[0].view, "link-sent");
  assert.equal(res.renderCalls[0].data.user_id, 84);
  assert.equal(state.sesEmails.length, 0);
  assert.equal(state.snsPublishes.length, 1);
});

test("POST /register creates account and sends magic link without real network", async () => {
  const { state } = loadAppWithMocks({
    uuid: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    db: {
      getUserByEmail: async () => null,
      createUser: async (payload) => {
        state.createUserPayloads.push(payload);
        return { id: 501, login_code: "778899" };
      },
    },
  });

  const handler = state.routes.post.get("/register");
  assert.ok(handler);

  const req = createReq({
    body: {
      name: "Alex Smith",
      email: "alex@example.com",
      phone: "",
      item: "12",
    },
  });
  const res = createRes();

  await handler(req, res);
  await flushAsync();

  assert.equal(state.createUserPayloads.length, 1);
  assert.equal(
    state.createUserPayloads[0].magic_code,
    "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  );
  assert.equal(res.renderCalls[0].view, "link-sent");
  assert.equal(res.renderCalls[0].data.user_id, 501);
  assert.equal(res.renderCalls[0].data.login_code, "778899");
  assert.equal(state.sesEmails.length, 1);
  assert.equal(state.snsPublishes.length, 0);
});

test("GET /magic renders login with errors when validation fails", async () => {
  const { state } = loadAppWithMocks();
  const handler = state.routes.get.get("/magic");
  assert.ok(handler);

  const req = createReq({
    __validationErrors: [{ msg: "invalid user" }],
    query: { user: "", code: "", item: "5" },
  });
  const res = createRes();

  await handler(req, res);

  assert.equal(res.renderCalls.length, 1);
  assert.equal(res.renderCalls[0].view, "login");
  assert.equal(res.renderCalls[0].data.item, "5");
  assert.equal(res.redirectCalls.length, 0);
});

test("GET /magic with invalid code does not set cookie and redirects", async () => {
  const { state } = loadAppWithMocks({
    db: {
      getMagicCodeForUser: async () => "expected-code",
    },
  });
  const handler = state.routes.get.get("/magic");
  assert.ok(handler);

  const req = createReq({
    query: { user: "12", code: "wrong-code", item: "9" },
  });
  const res = createRes();

  await handler(req, res);

  assert.equal(res.cookieCalls.length, 0);
  assert.equal(res.redirectCalls[0], "/signup?item=9");
});

test("POST /verify-otp sets auth cookie and redirects when OTP is valid", async () => {
  const { state } = loadAppWithMocks({
    jwtSignValue: "jwt-token-for-user",
    db: {
      checkUserOTP: async () => ({ id: 9 }),
    },
  });

  const handler = state.routes.post.get("/verify-otp");
  assert.ok(handler);

  const req = createReq({
    body: { user_id: "9", otp: "123456", item: "" },
  });
  const res = createRes();

  await handler(req, res);

  assert.equal(res.cookieCalls.length, 1);
  assert.equal(res.cookieCalls[0].name, "token");
  assert.equal(res.cookieCalls[0].value, "jwt-token-for-user");
  assert.equal(res.cookieCalls[0].options.httpOnly, true);
  assert.equal(res.cookieCalls[0].options.sameSite, "lax");
  assert.equal(res.redirectCalls[0], "/user");
});

test("POST /verify-otp renders link-sent when validation fails", async () => {
  const { state } = loadAppWithMocks();
  const handler = state.routes.post.get("/verify-otp");
  assert.ok(handler);

  const req = createReq({
    __validationErrors: [{ msg: "OTP must be exactly 6 digits." }],
    body: { user_id: "9", otp: "123", item: "4" },
  });
  const res = createRes();

  await handler(req, res);

  assert.equal(res.renderCalls.length, 1);
  assert.equal(res.renderCalls[0].view, "link-sent");
  assert.equal(res.renderCalls[0].data.user_id, "9");
  assert.equal(res.renderCalls[0].data.item, "4");
});

test("POST /verify-otp renders login when OTP is invalid", async () => {
  const { state } = loadAppWithMocks({
    db: {
      checkUserOTP: async () => null,
    },
  });
  const handler = state.routes.post.get("/verify-otp");
  assert.ok(handler);

  const req = createReq({
    body: { user_id: "9", otp: "123456", item: "3" },
  });
  const res = createRes();

  await handler(req, res);

  assert.equal(res.renderCalls.length, 1);
  assert.equal(res.renderCalls[0].view, "login");
  assert.equal(res.renderCalls[0].data.item, "3");
});

test("GET /user renders active and inactive signups for logged-in user", async () => {
  const active = [
    {
      id: 1,
      start_time: "2026-01-03T14:00:00.000Z",
      end_time: "2026-01-03T16:00:00.000Z",
    },
  ];
  const inactive = [
    {
      id: 2,
      start_time: "2026-01-10T14:00:00.000Z",
      end_time: "2026-01-10T16:00:00.000Z",
    },
  ];

  const { state } = loadAppWithMocks({
    db: {
      getActiveSignupsForUser: async () => active,
      getInactiveSignupsForUser: async () => inactive,
      isAdmin: async () => true,
    },
  });

  const handler = state.routes.get.get("/user");
  assert.ok(handler);

  const req = createReq({
    cookies: { token: "valid-token" },
    query: { success: "1" },
  });
  const res = createRes();

  await handler(req, res);

  assert.equal(res.renderCalls.length, 1);
  assert.equal(res.renderCalls[0].view, "user");
  assert.equal(res.renderCalls[0].data.signups.length, 1);
  assert.equal(res.renderCalls[0].data.inactive.length, 1);
  assert.ok(res.renderCalls[0].data.signups[0].start);
  assert.ok(res.renderCalls[0].data.inactive[0].end);
});

test("POST /signup returns 401 error view when user is not logged in", async () => {
  const { state } = loadAppWithMocks();
  const handler = state.routes.post.get("/signup");
  assert.ok(handler);

  const req = createReq({
    body: {
      item: "4",
      event: "2",
      quantity: "1",
      comment: "",
      submission_token: "11111111-1111-1111-1111-111111111111",
    },
    cookies: {},
  });
  const res = createRes();

  await handler(req, res);

  assert.equal(res.statusCode, 401);
  assert.equal(res.renderCalls.length, 1);
  assert.equal(res.renderCalls[0].view, "error");
  assert.equal(res.renderCalls[0].data.heading, "Login required");
});

test("POST /signup creates signup and renders success", async () => {
  let createdSignup;
  const { state } = loadAppWithMocks({
    db: {
      isAdmin: async () => false,
      createSignup: async (payload) => {
        createdSignup = payload;
        return 77;
      },
      getUser: async () => ({ id: 1, email: "donor@example.com" }),
      getItem: async () => ({
        id: 4,
        event_id: 8,
        title: "Toy Drive",
        notes: "Bring new items",
        email_info: "Dropoff info",
        start_time: "2026-02-01T15:00:00.000Z",
        end_time: "2026-02-01T17:00:00.000Z",
      }),
      getEvent: async () => ({
        id: 8,
        title: "Holiday Outreach",
        description: "Community support event",
        email_info: "Event-wide email notes",
      }),
    },
  });

  const handler = state.routes.post.get("/signup");
  const req = createReq({
    body: {
      item: "4",
      event: "8",
      quantity: "3",
      comment: "Will arrive early",
      submission_token: "22222222-2222-4222-8222-222222222222",
    },
    cookies: { token: "valid-token" },
  });
  const res = createRes();

  await handler(req, res);

  assert.equal(createdSignup.item_id, 4);
  assert.equal(createdSignup.user_id, 1);
  assert.equal(createdSignup.quantity, 3);
  assert.equal(
    createdSignup.submission_token,
    "22222222-2222-4222-8222-222222222222",
  );
  assert.equal(res.renderCalls.length, 1);
  assert.equal(res.renderCalls[0].view, "success");
  assert.equal(res.renderCalls[0].data.count, 3);
  assert.equal(state.sesEmails.length, 1);
});

test("POST /signup treats duplicate submission token as already processed", async () => {
  const duplicateError = new Error("duplicate key value violates unique constraint");
  duplicateError.code = "23505";
  duplicateError.constraint = "signups_submission_token_unique_idx";

  const { state } = loadAppWithMocks({
    db: {
      isAdmin: async () => false,
      createSignup: async () => {
        throw duplicateError;
      },
      getSignupBySubmissionToken: async () => ({
        id: 55,
        quantity: 2,
        comment: "Already submitted",
      }),
      getUser: async () => ({ id: 1, email: "donor@example.com" }),
      getItem: async () => ({
        id: 4,
        event_id: 8,
        title: "Toy Drive",
        notes: "Bring new items",
        email_info: "Dropoff info",
        start_time: "2026-02-01T15:00:00.000Z",
        end_time: "2026-02-01T17:00:00.000Z",
      }),
      getEvent: async () => ({
        id: 8,
        title: "Holiday Outreach",
        description: "Community support event",
        email_info: "Event-wide email notes",
      }),
    },
  });

  const handler = state.routes.post.get("/signup");
  const req = createReq({
    body: {
      item: "4",
      event: "8",
      quantity: "3",
      comment: "Will arrive early",
      submission_token: "33333333-3333-4333-8333-333333333333",
    },
    cookies: { token: "valid-token" },
  });
  const res = createRes();

  await handler(req, res);

  assert.equal(res.renderCalls.length, 1);
  assert.equal(res.renderCalls[0].view, "success");
  assert.equal(res.renderCalls[0].data.count, 2);
  assert.equal(res.renderCalls[0].data.comment, "Already submitted");
  assert.equal(state.sesEmails.length, 0);
});

test("POST /admin/event creates event and associates shelters", async () => {
  let createdEventPayload;
  let linkedShelters;

  const { state } = loadAppWithMocks({
    uuid: "dddddddd-1111-2222-3333-444444444444",
    db: {
      isAdmin: async () => true,
      createEvent: async (payload) => {
        createdEventPayload = payload;
        return 901;
      },
      createShelter: async (name) => ({ id: name === "Alpha House" ? 31 : 32 }),
      setEventShelters: async (eventId, shelterIds) => {
        linkedShelters = { eventId, shelterIds };
      },
      getShelters: async () => [],
    },
  });

  const handler = state.routes.post.get("/admin/event");
  assert.ok(handler);

  const req = createReq({
    cookies: { token: "admin-token" },
    body: {
      title: "Spring Drive",
      description: "Annual event",
      summary: "Quick summary",
      email_info: "Event notes",
      alert_email: "events-alerts@example.com",
      alert_on_signup: "on",
      alert_on_cancellation: "on",
      active: "on",
      adopt_signup: "true",
      allow_kids: "true",
      kid_title: "",
      kid_notes: "",
      kid_comments_label: "",
      kid_comments_help: "",
      kid_email_info: "",
      kid_needed: "0",
      shelters: ["5", "6"],
      new_shelters: "Alpha House\nBeta House",
    },
  });
  const res = createRes();

  await handler(req, res);

  assert.ok(createdEventPayload);
  assert.equal(createdEventPayload.title, "Spring Drive");
  assert.equal(createdEventPayload.form_code, "dddddddd-1111-2222-3333-444444444444");
  assert.equal(createdEventPayload.alert_email, "events-alerts@example.com");
  assert.equal(createdEventPayload.alert_on_signup, true);
  assert.equal(createdEventPayload.alert_on_cancellation, true);
  assert.equal(res.redirectCalls[0], "/admin/event/901");
  assert.equal(linkedShelters.eventId, 901);
  assert.equal(linkedShelters.shelterIds.join(","), "5,6,31,32");
});

test("POST /signup renders 400 error page when validation fails", async () => {
  const { state } = loadAppWithMocks();
  const handler = state.routes.post.get("/signup");
  assert.ok(handler);

  const req = createReq({
    __validationErrors: [{ msg: "Missing quantity" }],
    body: {
      item: "4",
      event: "2",
      quantity: "",
      comment: "",
      submission_token: "44444444-4444-4444-8444-444444444444",
    },
    cookies: { token: "valid-token" },
  });
  const res = createRes();

  await handler(req, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.renderCalls.length, 1);
  assert.equal(res.renderCalls[0].view, "error");
  assert.equal(res.renderCalls[0].data.heading, "Invalid signup");
});

test("GET /admin redirects to /login when not authenticated", async () => {
  const { state } = loadAppWithMocks();
  const handler = state.routes.get.get("/admin");
  assert.ok(handler);

  const req = createReq({ cookies: {} });
  const res = createRes();

  await handler(req, res);

  assert.equal(res.redirectCalls.length, 1);
  assert.equal(res.redirectCalls[0], "/login");
});

test("GET /admin redirects to / when authenticated non-admin user", async () => {
  const { state } = loadAppWithMocks({
    db: {
      isAdmin: async () => false,
    },
  });
  const handler = state.routes.get.get("/admin");
  assert.ok(handler);

  const req = createReq({ cookies: { token: "valid-token" } });
  const res = createRes();

  await handler(req, res);

  assert.equal(res.redirectCalls.length, 1);
  assert.equal(res.redirectCalls[0], "/");
});

test("POST /admin/event renders form with errors when validation fails", async () => {
  let createEventCalled = false;
  const { state } = loadAppWithMocks({
    db: {
      isAdmin: async () => true,
      createEvent: async () => {
        createEventCalled = true;
        return 123;
      },
      getShelters: async () => [],
    },
  });
  const handler = state.routes.post.get("/admin/event");
  assert.ok(handler);

  const req = createReq({
    __validationErrors: [{ msg: "Title is required" }],
    cookies: { token: "admin-token" },
    body: {
      title: "",
      description: "",
      summary: "",
      email_info: "",
      active: "on",
      adopt_signup: "false",
      allow_kids: "true",
      shelters: ["4"],
      new_shelters: "",
    },
  });
  const res = createRes();

  await handler(req, res);

  assert.equal(createEventCalled, false);
  assert.equal(res.renderCalls.length, 1);
  assert.equal(res.renderCalls[0].view, "new-event");
  assert.equal(Array.isArray(res.renderCalls[0].data.errors), true);
  assert.equal(res.renderCalls[0].data.errors[0].msg, "Title is required");
});

test("POST /admin/event redirects /login when unauthenticated", async () => {
  const { state } = loadAppWithMocks();
  const handler = state.routes.post.get("/admin/event");
  assert.ok(handler);

  const req = createReq({
    cookies: {},
    body: {},
  });
  const res = createRes();

  await handler(req, res);

  assert.equal(res.redirectCalls.length, 1);
  assert.equal(res.redirectCalls[0], "/login");
});

test("POST /admin/event redirects / when user is not admin", async () => {
  const { state } = loadAppWithMocks({
    db: {
      isAdmin: async () => false,
    },
  });
  const handler = state.routes.post.get("/admin/event");
  assert.ok(handler);

  const req = createReq({
    cookies: { token: "valid-token" },
    body: {},
  });
  const res = createRes();

  await handler(req, res);

  assert.equal(res.redirectCalls.length, 1);
  assert.equal(res.redirectCalls[0], "/");
});

test("POST /admin/event renders error when alerts enabled without alert email", async () => {
  let createEventCalled = false;
  const { state } = loadAppWithMocks({
    db: {
      isAdmin: async () => true,
      createEvent: async () => {
        createEventCalled = true;
        return 321;
      },
      getShelters: async () => [],
    },
  });
  const handler = state.routes.post.get("/admin/event");
  assert.ok(handler);

  const req = createReq({
    cookies: { token: "admin-token" },
    body: {
      title: "Spring Drive",
      description: "Annual event",
      summary: "Quick summary",
      email_info: "Event notes",
      alert_email: "",
      alert_on_signup: "on",
      alert_on_cancellation: "on",
      active: "on",
      adopt_signup: "false",
      allow_kids: "true",
      shelters: [],
      new_shelters: "",
    },
  });
  const res = createRes();

  await handler(req, res);

  assert.equal(createEventCalled, false);
  assert.equal(res.renderCalls.length, 1);
  assert.equal(res.renderCalls[0].view, "new-event");
  assert.equal(res.renderCalls[0].data.errors[0].msg.includes("required"), true);
});

test("GET /admin/item/delete deletes item when it has no active signups", async () => {
  let deletedItemId = null;
  let disabledPayload = null;
  const { state } = loadAppWithMocks({
    db: {
      isAdmin: async () => true,
      hasActiveSignupsForItem: async () => false,
      deleteItem: async (itemId) => {
        deletedItemId = itemId;
      },
      setItemActive: async (itemId, active) => {
        disabledPayload = { itemId, active };
      },
    },
  });
  const handler = state.routes.get.get("/admin/item/delete");
  assert.ok(handler);

  const req = createReq({
    cookies: { token: "admin-token" },
    query: { event: "8", item: "12" },
  });
  const res = createRes();

  await handler(req, res);

  assert.equal(deletedItemId, "12");
  assert.equal(disabledPayload, null);
  assert.equal(res.redirectCalls[0], "/admin/event/8");
});

test("GET /admin/item/delete disables item when it has active signups", async () => {
  let deletedItemId = null;
  let disabledPayload = null;
  const { state } = loadAppWithMocks({
    db: {
      isAdmin: async () => true,
      hasActiveSignupsForItem: async () => true,
      deleteItem: async (itemId) => {
        deletedItemId = itemId;
      },
      setItemActive: async (itemId, active) => {
        disabledPayload = { itemId, active };
      },
    },
  });
  const handler = state.routes.get.get("/admin/item/delete");
  assert.ok(handler);

  const req = createReq({
    cookies: { token: "admin-token" },
    query: { event: "8", item: "12" },
  });
  const res = createRes();

  await handler(req, res);

  assert.equal(deletedItemId, null);
  assert.deepEqual(disabledPayload, { itemId: "12", active: false });
  assert.equal(res.redirectCalls[0], "/admin/event/8");
});

test("GET /admin/item/activate redirects to /login when unauthenticated", async () => {
  const { state } = loadAppWithMocks();
  const handler = state.routes.get.get("/admin/item/activate");
  assert.ok(handler);

  const req = createReq({
    cookies: {},
    query: { event: "8", item: "12", active: "false" },
  });
  const res = createRes();

  await handler(req, res);

  assert.equal(res.redirectCalls.length, 1);
  assert.equal(res.redirectCalls[0], "/login");
});

test("GET /admin/item/activate updates active flag and redirects", async () => {
  let payload = null;
  const { state } = loadAppWithMocks({
    db: {
      isAdmin: async () => true,
      setItemActive: async (itemId, active) => {
        payload = { itemId, active };
      },
    },
  });
  const handler = state.routes.get.get("/admin/item/activate");
  assert.ok(handler);

  const req = createReq({
    cookies: { token: "admin-token" },
    query: { event: "8", item: "12", active: "false" },
  });
  const res = createRes();

  await handler(req, res);

  assert.deepEqual(payload, { itemId: "12", active: false });
  assert.equal(res.redirectCalls.length, 1);
  assert.equal(res.redirectCalls[0], "/admin/event/8");
});

test("GET /admin/kid/approve-all redirects to /login when unauthenticated", async () => {
  const { state } = loadAppWithMocks();
  const handler = state.routes.get.get("/admin/kid/approve-all");
  assert.ok(handler);

  const req = createReq({
    cookies: {},
    query: { event: "17" },
  });
  const res = createRes();

  await handler(req, res);

  assert.equal(res.redirectCalls.length, 1);
  assert.equal(res.redirectCalls[0], "/login");
});

test("GET /admin/kid/approve-all approves all pending kids and redirects", async () => {
  const approvedKidIds = [];
  const { state } = loadAppWithMocks({
    db: {
      isAdmin: async () => true,
      getPendingKidsForEvent: async () => [{ id: 11 }, { id: 12 }, { id: 15 }],
      approveKid: async (kidId) => {
        approvedKidIds.push(kidId);
      },
    },
  });
  const handler = state.routes.get.get("/admin/kid/approve-all");
  assert.ok(handler);

  const req = createReq({
    cookies: { token: "admin-token" },
    query: { event: "17" },
  });
  const res = createRes();

  await handler(req, res);

  assert.equal(approvedKidIds.join(","), "11,12,15");
  assert.equal(res.redirectCalls.length, 1);
  assert.equal(res.redirectCalls[0], "/admin/event/17");
});

test("GET /healthz returns 503 when db health check fails", async () => {
  const { state } = loadAppWithMocks({
    db: {
      healthCheck: async () => {
        throw new Error("db unavailable");
      },
    },
  });

  const handler = state.routes.get.get("/healthz");
  assert.ok(handler);

  const req = createReq();
  const res = createRes();

  await handler(req, res);

  assert.equal(res.statusCode, 503);
  assert.equal(res.jsonCalls.length, 1);
  assert.equal(res.jsonCalls[0].status, "error");
});
