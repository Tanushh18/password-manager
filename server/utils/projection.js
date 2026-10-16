/**
 * Mongo projection that leaves out the named fields: find(filter, without("passwords")).
 * The account document is large; background jobs load many accounts, so each one asks only for what it reads.
 */
const without = (...fields) => Object.fromEntries(fields.flat().map((field) => [field, 0]));

module.exports = { without };
