// The app only has local fact-sheet PDFs (in References/) for 24 playable warbands.
// The remaining warbands were originally seeded from "Mordheim_Sheetv2.3.xlsx", a
// spreadsheet that is not available in this repository, so their data (including the
// upcoming skill-eligibility work) cannot be verified against a source document.
// Retire them the same way "Dwarf Slayers" was retired previously: flip is_available
// to false so they disappear from the catalog/roster-creation APIs, without destroying
// any underlying data in case the source spreadsheet becomes available again later.
const unsourcedReference = "Mordheim_Sheetv2.3.xlsx";

exports.up = async function up(knex) {
  await knex("warbands").where({ source_reference: unsourcedReference }).update({
    is_available: false,
    updated_at: new Date(),
  });
};

exports.down = async function down(knex) {
  await knex("warbands").where({ source_reference: unsourcedReference }).update({
    is_available: true,
    updated_at: new Date(),
  });
};
