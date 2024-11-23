const { init: dbInit, cleanDatabase } = require("../db");

(async () => {
  await dbInit(false);
  await cleanDatabase();
})();

