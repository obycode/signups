const dotenv = require("dotenv");
dotenv.config();
const Pool = require("pg").Pool;
const parse = require("pg-connection-string").parse;

async function ensureEventsTable(client) {
  const exists = await client.query(`SELECT EXISTS (
    SELECT FROM information_schema.tables
    WHERE table_name = 'events'
  );`);

  if (!exists.rows[0].exists) {
    await client.query(`
      CREATE TABLE events (
        id SERIAL PRIMARY KEY,
        title TEXT,
        description TEXT,
        email_info TEXT,
        image TEXT,
        active BOOLEAN
    );
    `);
    console.log("Created 'events' table.");
  }
}

async function ensureItemsTable(client) {
  const exists = await client.query(`SELECT EXISTS (
    SELECT FROM information_schema.tables
    WHERE table_name = 'items'
  );`);

  if (!exists.rows[0].exists) {
    await client.query(`
      CREATE TABLE items (
        id SERIAL PRIMARY KEY,
        event_id INTEGER,
        title TEXT,
        notes TEXT,
        email_info TEXT,
        start_time TIMESTAMP,
        end_time TIMESTAMP,
        needed INTEGER
    );
    `);
    console.log("Created 'items' table.");
  }
}

async function ensureUsersTable(client) {
  const exists = await client.query(`SELECT EXISTS (
    SELECT FROM information_schema.tables
    WHERE table_name = 'users'
  );`);

  if (!exists.rows[0].exists) {
    await client.query(`
      CREATE TABLE users (
        id SERIAL PRIMARY KEY,
        name TEXT,
        email TEXT,
        phone TEXT,
        magic_code TEXT
    );
    `);
    console.log("Created 'users' table.");
  }
}

async function ensureSignupsTable(client) {
  const exists = await client.query(`SELECT EXISTS (
    SELECT FROM information_schema.tables
    WHERE table_name = 'signups'
  );`);

  if (!exists.rows[0].exists) {
    await client.query(`
      CREATE TABLE signups (
        id SERIAL PRIMARY KEY,
        item_id INTEGER,
        user_id INTEGER,
        quantity INTEGER,
        comment TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    `);
    console.log("Created 'signups' table.");
  }
}

let pool;

async function init() {
  const config = parse(process.env.DATABASE_URL);
  if (process.env.NODE_ENV) {
    config.ssl = {
      rejectUnauthorized: false,
    };
  }

  pool = new Pool(config);
  const client = await pool.connect();
  try {
    ensureEventsTable(client);
    ensureItemsTable(client);
    ensureUsersTable(client);
    ensureSignupsTable(client);
  } catch (err) {
    console.error("Error initializing tables:", err);
  } finally {
    client.release();
  }

  return pool;
}

// EVENTS

async function createEvent(event) {
  const result = await pool.query(
    `
    INSERT INTO events (title, description, email_info, image, active)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING id
  `,
    [
      event.title,
      event.description,
      event.email_info,
      event.image,
      event.active,
    ]
  );
  return result.rows[0].id;
}

async function getEvent(event_id) {
  try {
    const result = await pool.query(
      `
        SELECT * FROM events
        WHERE id = $1
      `,
      [event_id]
    );

    if (result.rows.length === 0) {
      return null;
    }
    return result.rows[0];
  } catch (err) {
    console.error(err);
    return null;
  }
}

async function getActiveEvents() {
  try {
    const result = await pool.query(
      `
        SELECT * FROM events
        WHERE active = true
      `
    );
    return result.rows;
  } catch (err) {
    console.error(err);
    return [];
  }
}

// ITEMS

async function createItem(item) {
  const result = await pool.query(
    `
    INSERT INTO items (event_id, title, notes, start_time, end_time, needed)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING id
  `,
    [
      item.event_id,
      item.title,
      item.notes,
      item.start_time,
      item.end_time,
      item.needed,
    ]
  );
  return result.rows[0].id;
}

async function getItem(item_id) {
  try {
    const result = await pool.query(
      `
        SELECT * FROM items
        WHERE id = $1
      `,
      [item_id]
    );

    if (result.rows.length === 0) {
      return null;
    }
    return result.rows[0];
  } catch (err) {
    console.error(err);
    return null;
  }
}

async function getItemsForEvent(event_id) {
  try {
    // Join with signups to get the number of signups for each item
    const result = await pool.query(
      `
        SELECT items.*, COUNT(signups.id) AS signups
        FROM items
        LEFT JOIN signups ON items.id = signups.item_id
        WHERE event_id = $1
        GROUP BY items.id
        ORDER BY signups ASC
      `,
      [event_id]
    );
    return result.rows;
  } catch (err) {
    console.error(err);
    return [];
  }
}

// USERS

async function createUser(user) {
  const result = await pool.query(
    `
      INSERT INTO users (name, email, phone, magic_code)
      VALUES ($1, $2, $3, $4)
      RETURNING id
    `,
    [user.name, user.email, user.phone, user.magic_code]
  );
  return result.rows[0].id;
}

async function getUser(user_id) {
  try {
    const result = await pool.query(
      `
        SELECT * FROM users
        WHERE id = $1
      `,
      [user_id]
    );
    return result.rows[0];
  } catch (err) {
    console.error(err);
    return null;
  }
}

async function getUserByEmail(email) {
  try {
    const result = await pool.query(
      `
        SELECT * FROM users
        WHERE email = $1
      `,
      [email]
    );

    if (result.rows.length === 0) {
      return null;
    }

    return result.rows[0];
  } catch (err) {
    console.error(err);
    return null;
  }
}

async function getMagicCodeForUser(user_id) {
  try {
    const result = await pool.query(
      `
        SELECT magic_code FROM users
        WHERE id = $1
      `,
      [user_id]
    );
    return result.rows[0].magic_code;
  } catch (err) {
    console.error(err);
    return null;
  }
}

// SIGNUPS

async function createSignup(signup) {
  const result = await pool.query(
    `
    INSERT INTO signups (item_id, user_id, quantity)
    VALUES ($1, $2, $3)
    RETURNING id
  `,
    [signup.item_id, signup.user_id, signup.quantity]
  );
  return result.rows[0].id;
}

async function getActiveSignupsForUser(user_id) {
  try {
    const result = await pool.query(
      `
        SELECT signups.id, signups.user_id, items.event_id,
          items.title AS item_title, items.start_time,
          items.end_time, signups.quantity, items.notes
        FROM signups
        JOIN items ON signups.item_id = items.id
        JOIN events ON items.event_id = events.id
        WHERE user_id = $1 AND events.active = true
      `,
      [user_id]
    );
    return result.rows;
  } catch (err) {
    console.error(err);
    return [];
  }
}

async function getInactiveSignupsForUser(user_id) {
  try {
    const result = await pool.query(
      `
        SELECT signups.id, signups.user_id, items.event_id,
          items.title AS item_title, items.start_time,
          items.end_time, signups.quantity, items.notes
        FROM signups
        JOIN items ON signups.item_id = items.id
        JOIN events ON items.event_id = events.id
        WHERE user_id = $1 AND events.active = false
      `,
      [user_id]
    );
    return result.rows;
  } catch (err) {
    console.error(err);
    return [];
  }
}

async function getSignup(signup_id) {
  try {
    const result = await pool.query(
      `
        SELECT * FROM signups
        WHERE id = $1
      `,
      [signup_id]
    );

    if (result.rows.length === 0) {
      return null;
    }
    return result.rows[0];
  } catch (err) {
    console.error(err);
    return null;
  }
}

async function deleteSignup(signup_id) {
  try {
    await pool.query(
      `
        DELETE FROM signups
        WHERE id = $1
      `,
      [signup_id]
    );
  } catch (err) {
    console.error(err);
  }
}

module.exports = {
  init,
  createEvent,
  getActiveEvents,
  createItem,
  getItem,
  getEvent,
  getItemsForEvent,
  createUser,
  getUser,
  getUserByEmail,
  getMagicCodeForUser,
  createSignup,
  getActiveSignupsForUser,
  getInactiveSignupsForUser,
  getSignup,
  deleteSignup,
};
