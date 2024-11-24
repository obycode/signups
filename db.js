const dotenv = require("dotenv");
dotenv.config();
const Pool = require("pg").Pool;
const parse = require("pg-connection-string").parse;
const pug = require("pug");
const { decode } = require("entities");

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
        summary TEXT,
        description TEXT,
        email_info TEXT,
        image TEXT,
        active BOOLEAN,
        form_code TEXT,
        adopt_signup BOOLEAN,
        kid_title TEXT,
        kid_notes TEXT,
        kid_email_info TEXT,
        kid_needed INTEGER
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
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        canceled_at TIMESTAMP
      );
    `);
    console.log("Created 'signups' table.");
  }
}

async function ensureKidsTable(client) {
  const exists = await client.query(`SELECT EXISTS (
    SELECT FROM information_schema.tables
    WHERE table_name = 'kids'
  );`);

  if (!exists.rows[0].exists) {
    await client.query(`
      CREATE TABLE kids (
        id SERIAL PRIMARY KEY,
        event INTEGER,
        name TEXT,
        shelter INTEGER,
        age INTEGER,
        gender TEXT,
        shirt_size TEXT,
        pant_size TEXT,
        color TEXT,
        comments TEXT,
        internal TEXT,
        added BOOLEAN DEFAULT FALSE
      );
    `);
    console.log("Created 'kids' table.");
  }
}

async function ensureAdminTable(client) {
  const exists = await client.query(`SELECT EXISTS (
    SELECT FROM information_schema.tables
    WHERE table_name = 'admin'
  );`);

  if (!exists.rows[0].exists) {
    await client.query(`
      CREATE TABLE admin (
        user_id INTEGER PRIMARY KEY
      );
    `);
    console.log("Created 'admin' table.");
  }
}

async function ensureSheltersTable(client) {
  const exists = await client.query(`SELECT EXISTS (
    SELECT FROM information_schema.tables
    WHERE table_name = 'shelters'
  );`);

  if (!exists.rows[0].exists) {
    await client.query(`
      CREATE TABLE shelters (
        id SERIAL PRIMARY KEY,
        name TEXT,
      );
    `);
    console.log("Created 'shelters' table.");
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
    ensureKidsTable(client);
    ensureAdminTable(client);
    ensureSheltersTable(client);
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
    INSERT INTO events (title, summary, description, email_info, image, active, form_code, adopt_signup, kid_title, kid_notes, kid_email_info, kid_needed)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    RETURNING id
  `,
    [
      event.title,
      event.summary,
      event.description,
      event.email_info,
      event.image,
      event.active,
      event.form_code,
      event.adopt_signup,
      event.kid_title,
      event.kid_notes,
      event.kid_email_info,
      event.kid_needed,
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

async function getEvents() {
  try {
    const result = await pool.query(
      `
        SELECT * FROM events ORDER BY active DESC, id DESC
      `
    );
    return result.rows;
  } catch (err) {
    console.error(err);
    return [];
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

async function updateEvent(event_id, event) {
  // Dynamically construct the SET clause
  const setClause = `
    title = $1, summary = $2, description = $3, email_info = $4, active = $5,
    adopt_signup = $6, kid_title = $7, kid_notes = $8, kid_email_info = $9, kid_needed = $10
    ${event.image ? ", image = $11" : ""}
  `;

  // Use the correct positional placeholder for the WHERE clause
  const whereClause = `WHERE id = ${event.image ? "$12" : "$11"}`;

  // Combine the query
  const query = `
    UPDATE events
    SET ${setClause}
    ${whereClause}
  `;

  // Build the values array
  const values = event.image
    ? [
        event.title,
        event.summary,
        event.description,
        event.email_info,
        event.active,
        event.adopt_signup,
        event.kid_title,
        event.kid_notes,
        event.kid_email_info,
        event.kid_needed,
        event.image,
        event_id,
      ]
    : [
        event.title,
        event.summary,
        event.description,
        event.email_info,
        event.active,
        event.adopt_signup,
        event.kid_title,
        event.kid_notes,
        event.kid_email_info,
        event.kid_needed,
        event_id,
      ];

  await pool.query(query, values);
}

async function activateEvent(event_id, active) {
  await pool.query(
    `
    UPDATE events
    SET active = $1
    WHERE id = $2
  `,
    [active, event_id]
  );
}

async function deleteEvent(event_id) {
  await pool.query(
    `
    DELETE FROM events
    WHERE id = $1
  `,
    [event_id]
  );
}

// ITEMS

async function createItem(item) {
  const result = await pool.query(
    `
    INSERT INTO items (event_id, title, notes, email_info, start_time, end_time, needed)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING id
  `,
    [
      item.event_id,
      item.title,
      item.notes,
      item.email_info,
      item.start_time || null,
      item.end_time || null,
      item.needed,
    ]
  );
  return result.rows[0].id;
}

async function updateItem(item_id, item) {
  await pool.query(
    `
    UPDATE items
    SET title = $1, notes = $2, email_info = $3, start_time = $4, end_time = $5, needed = $6
    WHERE id = $7
  `,
    [
      item.title,
      item.notes,
      item.email_info,
      item.start_time || null,
      item.end_time || null,
      item.needed,
      item_id,
    ]
  );
}

async function deleteItem(item_id) {
  await pool.query(
    `
    DELETE FROM items
    WHERE id = $1
  `,
    [item_id]
  );
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

async function getItemsForEvent(event_id, skip, limit) {
  try {
    // Join with signups to get the number of signups for each item
    const result = await pool.query(
      `
        SELECT items.*, COALESCE(SUM(signups.quantity), 0) AS signups
        FROM items
        LEFT JOIN signups ON items.id = signups.item_id AND signups.canceled_at IS NULL
        WHERE event_id = $1
        GROUP BY items.id
        ORDER BY COALESCE(items.start_time, items.end_time), signups ASC
        LIMIT $2 OFFSET $3;
      `,
      [event_id, limit, skip]
    );
    return result.rows;
  } catch (err) {
    console.error(err);
    return [];
  }
}

async function countItemsForEvent(event_id) {
  try {
    const result = await pool.query(
      `
        SELECT COUNT(*) AS total
        FROM items
        WHERE event_id = $1;
      `,
      [event_id]
    );
    return parseInt(result.rows[0].total, 10);
  } catch (err) {
    console.error(err);
    return 0;
  }
}

async function countNeededForEvent(event_id) {
  try {
    const result = await pool.query(
      `
        SELECT SUM(needed) AS total
        FROM items
        WHERE event_id = $1;
      `,
      [event_id]
    );
    return parseInt(result.rows[0].total, 10);
  } catch (err) {
    console.error(err);
    return 0;
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
    INSERT INTO signups (item_id, user_id, quantity, comment)
    VALUES ($1, $2, $3, $4)
    RETURNING id
  `,
    [signup.item_id, signup.user_id, signup.quantity, signup.comment]
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
        WHERE user_id = $1 AND events.active = true AND signups.canceled_at IS NULL
        ORDER BY COALESCE(items.start_time, items.end_time)
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
        WHERE user_id = $1 AND events.active = false AND signups.canceled_at IS NULL
        ORDER BY COALESCE(items.start_time, items.end_time)
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

async function cancelSignup(signup_id) {
  try {
    await pool.query(
      `
        UPDATE signups
        SET canceled_at = CURRENT_TIMESTAMP
        WHERE id = $1
      `,
      [signup_id]
    );
  } catch (err) {
    console.error(err);
  }
}

async function getSignupsForEvent(event_id) {
  try {
    const result = await pool.query(
      `
        SELECT items.id AS item_id, items.title AS item_title,
               items.start_time, items.end_time,
               users.name AS user_name, users.email,
               signups.id, signups.quantity, signups.comment
        FROM signups
        JOIN items ON signups.item_id = items.id
        JOIN events ON items.event_id = events.id
        JOIN users ON signups.user_id = users.id
        WHERE events.id = $1 AND signups.canceled_at IS NULL
        ORDER BY COALESCE(items.start_time, items.end_time);
      `,
      [event_id]
    );
    return result.rows;
  } catch (err) {
    console.error(err);
    return [];
  }
}

// KIDS

async function createKid(event, kid) {
  const result = await pool.query(
    `
    INSERT INTO kids (event, name, shelter, age, gender, shirt_size, pant_size, color, comments, internal)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    RETURNING id
  `,
    [
      event,
      kid.name,
      kid.shelter,
      kid.age,
      kid.gender,
      kid.shirt_size,
      kid.pant_size,
      kid.color,
      kid.comments,
      kid.internal,
    ]
  );
  return result.rows[0].id;
}

async function getKid(kid_id) {
  try {
    const result = await pool.query(
      `
        SELECT * FROM kids
        WHERE id = $1
      `,
      [kid_id]
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

async function updateKid(kid_id, kid) {
  await pool.query(
    `
    UPDATE kids
    SET event = $1, name = $2, shelter = $3, age = $4, gender = $5,
      shirt_size = $6, pant_size = $7, color = $8, comments = $9,
      internal = $10, added = $11
    WHERE id = $12
  `,
    [
      kid.event,
      kid.name,
      kid.shelter,
      kid.age,
      kid.gender,
      kid.shirt_size,
      kid.pant_size,
      kid.color,
      kid.comments,
      kid.internal,
      kid.added,
      kid_id,
    ]
  );
}

async function getKidsForEvent(event_id) {
  try {
    const result = await pool.query(
      `
        SELECT kids.*, shelters.name AS shelter_name
        FROM kids
        JOIN shelters ON kids.shelter = shelters.id
        WHERE event = $1
        AND added = TRUE
        ORDER BY shelters.name, kids.id
      `,
      [event_id]
    );
    return result.rows;
  } catch (err) {
    console.error(err);
    return [];
  }
}

async function getPendingKidsForEvent(event_id) {
  try {
    const result = await pool.query(
      `
        SELECT kids.*, shelters.name AS shelter_name
        FROM kids
        JOIN shelters ON kids.shelter = shelters.id
        WHERE event = $1
        AND added = FALSE
        ORDER BY shelter, id
      `,
      [event_id]
    );
    return result.rows;
  } catch (err) {
    console.error(err);
    return [];
  }
}

async function deleteKid(kid_id) {
  await pool.query(
    `
    DELETE FROM kids
    WHERE id = $1
  `,
    [kid_id]
  );
}

async function approveKid(kid_id) {
  await pool.query(
    `
    UPDATE kids SET added = TRUE WHERE id = $1
  `,
    [kid_id]
  );

  let kid = await getKid(kid_id);
  kid.shelter_id = String.fromCharCode(64 + kid.shelter);
  let event = await getEvent(kid.event);
  let item = {
    event_id: kid.event,
    title: pug.render(`| ${event.kid_title}`, kid),
    notes: pug.render(event.kid_notes, kid),
    email_info: pug.render(event.kid_email_info, kid),
    needed: event.kid_needed,
  };
  await createItem(item);
}

// ADMIN

async function isAdmin(user_id) {
  if (!user_id) {
    return false;
  }

  try {
    const result = await pool.query(
      `
        SELECT * FROM admin
        WHERE user_id = $1
      `,
      [user_id]
    );

    return result.rows.length > 0;
  } catch (err) {
    console.error(err);
    return false;
  }
}

// SHELTERS

async function getShelters() {
  try {
    const result = await pool.query(
      `
        SELECT * FROM shelters
      `
    );
    return result.rows;
  } catch (err) {
    console.error(err);
    return [];
  }
}

async function getShelter(shelter_id) {
  try {
    const result = await pool.query(
      `
        SELECT name FROM shelters
        WHERE id = $1
      `,
      [shelter_id]
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

/// Clean up escaped characters in the database
async function cleanDatabase() {
  try {
    const result = await pool.query(
      "SELECT id, name, gender, shirt_size, pant_size, color, comments, internal FROM kids"
    );
    for (const row of result.rows) {
      const cleanedName = decode(row.name);
      const cleanedGender = decode(row.gender);
      const cleanedShirtSize = decode(row.shirt_size);
      const cleanedPantSize = decode(row.pant_size);
      const cleanedColor = decode(row.color || "");
      const cleanedComments = decode(row.comments || "");
      const cleanedInternal = decode(row.internal || "");

      console.log("Row:", row);
      await pool.query(
        "UPDATE kids SET name = $1, gender = $2, shirt_size = $3, pant_size = $4, color = $5, comments = $6, internal = $7 WHERE id = $8",
        [
          cleanedName,
          cleanedGender,
          cleanedShirtSize,
          cleanedPantSize,
          cleanedColor,
          cleanedComments,
          cleanedInternal,
          row.id,
        ]
      );
    }
    console.log("Database cleaned successfully!");
  } catch (err) {
    console.error("Error cleaning database:", err);
  }
}

module.exports = {
  init,
  createEvent,
  getEvents,
  getActiveEvents,
  createItem,
  updateItem,
  deleteItem,
  getItem,
  getEvent,
  getItemsForEvent,
  countItemsForEvent,
  countNeededForEvent,
  updateEvent,
  deleteEvent,
  activateEvent,
  createUser,
  getUser,
  getUserByEmail,
  getMagicCodeForUser,
  createSignup,
  getActiveSignupsForUser,
  getInactiveSignupsForUser,
  getSignup,
  cancelSignup,
  getSignupsForEvent,
  createKid,
  getKid,
  updateKid,
  getKidsForEvent,
  getPendingKidsForEvent,
  deleteKid,
  approveKid,
  isAdmin,
  getShelters,
  getShelter,
  cleanDatabase,
};
