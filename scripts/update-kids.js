const dotenv = require("dotenv");
dotenv.config();
const Airtable = require("airtable");
const { JSDOM } = require("jsdom");

Airtable.configure({
  apiKey: process.env.AIRTABLE_API_KEY,
});
const base = Airtable.base(process.env.AIRTABLE_BASE);

async function main() {
  let items = await base("Items").select().all();

  for (let item of items) {
    if (item.get("Event") == "recZnInmgAzcelnht") {
      const dom = new JSDOM(item.get("Notes"));
      const document = dom.window.document;

      const listItems = document.querySelectorAll("li");

      let childId = null;

      listItems.forEach((item) => {
        if (item.textContent.includes("Child ID")) {
          childId = item.textContent.split(":")[1].trim();
        }
      });

      if (childId) {
        await base("Items").update([
          {
            id: item.id,
            fields: {
              "Title": childId,
            },
          },
        ]);
      }
    }
  }
}

main();
