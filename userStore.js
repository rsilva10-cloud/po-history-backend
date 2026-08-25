/**
 * userStore.js
 * ------------
 * Who's allowed to log into this tool, their passwords (hashed with
 * bcrypt, never stored or logged in plain text), and whether they're an
 * admin. Only admins can add or remove accounts — everyone else can use
 * the tool but can't change who else has access.
 */

const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");

const DATA_FILE = process.env.USER_DATA_FILE || path.join(__dirname, "data", "users.json");
const SALT_ROUNDS = 10;

function ensureDataFile() {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, "[]", "utf8");
}

function readAll() {
  ensureDataFile();
  const raw = fs.readFileSync(DATA_FILE, "utf8");
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeAll(users) {
  ensureDataFile();
  fs.writeFileSync(DATA_FILE, JSON.stringify(users, null, 2), "utf8");
}

// Never returns the password hash — this is what list/management UIs get.
function readAllPublic() {
  return readAll().map(({ email, name, isAdmin, addedAt }) => ({ email, name, isAdmin: !!isAdmin, addedAt }));
}

function findByEmail(email) {
  const target = String(email).toLowerCase();
  return readAll().find((u) => u.email.toLowerCase() === target) || null;
}

function isAdmin(email) {
  const user = findByEmail(email);
  return !!(user && user.isAdmin);
}

// isAdminFlag left as `undefined` (not defaulted to false) on purpose:
// that's how we distinguish "caller didn't specify" from "caller
// explicitly wants this false" — matters for the reset-password case
// below, where not specifying it must preserve the existing admin status
// rather than silently demoting someone every time their password resets.
async function add(email, name, plainPassword, isAdminFlag) {
  const users = readAll();
  const target = String(email).toLowerCase();
  const passwordHash = await bcrypt.hash(plainPassword, SALT_ROUNDS);
  const existingIdx = users.findIndex((u) => u.email.toLowerCase() === target);

  if (existingIdx === -1) {
    users.push({
      email: target,
      name: name || email,
      passwordHash,
      isAdmin: isAdminFlag === undefined ? false : !!isAdminFlag,
      addedAt: new Date().toISOString(),
    });
  } else {
    users[existingIdx] = {
      ...users[existingIdx],
      name: name || users[existingIdx].name,
      passwordHash,
      isAdmin: isAdminFlag === undefined ? users[existingIdx].isAdmin : !!isAdminFlag,
    };
  }
  writeAll(users);
  return readAllPublic();
}

function remove(email) {
  const target = String(email).toLowerCase();
  const users = readAll().filter((u) => u.email.toLowerCase() !== target);
  writeAll(users);
  return readAllPublic();
}

async function verifyPassword(email, plainPassword) {
  const user = findByEmail(email);
  if (!user) return null;
  const match = await bcrypt.compare(plainPassword, user.passwordHash);
  return match ? { email: user.email, name: user.name, isAdmin: !!user.isAdmin } : null;
}

module.exports = { readAllPublic, findByEmail, isAdmin, add, remove, verifyPassword };
