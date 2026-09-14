/**
 * userStore.js
 * ------------
 * Who's allowed to log into this tool, their passwords (hashed with
 * bcrypt, never stored or logged in plain text), and their role.
 *
 * Roles: "admin" (can add/remove users, plus everything below),
 * "finance" (can generate invoices), "orderEntry" (default — everyday
 * order entry work, cannot generate invoices).
 *
 * Backward compatibility: records created before roles existed only have
 * an `isAdmin` boolean. readAll() normalizes those on the way out — an
 * old isAdmin:true becomes role:"admin", isAdmin:false/missing becomes
 * role:"orderEntry" — so nothing needs a one-time migration script.
 */

const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");

const DATA_FILE = process.env.USER_DATA_FILE || path.join(__dirname, "data", "users.json");
const SALT_ROUNDS = 10;
const VALID_ROLES = ["admin", "finance", "orderEntry"];

function normalizeRole(user) {
  if (VALID_ROLES.includes(user.role)) return user.role;
  return user.isAdmin ? "admin" : "orderEntry"; // legacy records pre-dating roles
}

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
    return Array.isArray(parsed) ? parsed.map((u) => ({ ...u, role: normalizeRole(u) })) : [];
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
  return readAll().map(({ email, name, role, addedAt }) => ({ email, name, role, addedAt }));
}

function findByEmail(email) {
  const target = String(email).toLowerCase();
  return readAll().find((u) => u.email.toLowerCase() === target) || null;
}

function getRole(email) {
  const user = findByEmail(email);
  return user ? user.role : null;
}

function isAdmin(email) {
  return getRole(email) === "admin";
}

// roleValue left as `undefined` (not defaulted) on purpose: distinguishes
// "caller didn't specify" from "caller explicitly wants this role" —
// matters for the reset-password case below, where not specifying it must
// preserve the existing role rather than silently resetting it to
// orderEntry every time someone's password is reset.
async function add(email, name, plainPassword, roleValue) {
  const users = readAll();
  const target = String(email).toLowerCase();
  const passwordHash = await bcrypt.hash(plainPassword, SALT_ROUNDS);
  const existingIdx = users.findIndex((u) => u.email.toLowerCase() === target);
  const role = VALID_ROLES.includes(roleValue) ? roleValue : undefined;

  if (existingIdx === -1) {
    users.push({
      email: target,
      name: name || email,
      passwordHash,
      role: role || "orderEntry",
      addedAt: new Date().toISOString(),
    });
  } else {
    users[existingIdx] = {
      ...users[existingIdx],
      name: name || users[existingIdx].name,
      passwordHash,
      role: role || users[existingIdx].role,
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

// Changes only the role — leaves passwordHash and everything else on the
// record untouched, unlike add() which is also used for password resets.
function setRole(email, role) {
  const users = readAll();
  const target = String(email).toLowerCase();
  const idx = users.findIndex((u) => u.email.toLowerCase() === target);
  if (idx === -1) return null;
  users[idx] = { ...users[idx], role };
  writeAll(users);
  return readAllPublic();
}

async function verifyPassword(email, plainPassword) {
  const user = findByEmail(email);
  if (!user) return null;
  const match = await bcrypt.compare(plainPassword, user.passwordHash);
  return match ? { email: user.email, name: user.name, role: user.role } : null;
}

module.exports = { readAllPublic, findByEmail, getRole, isAdmin, add, remove, setRole, verifyPassword, VALID_ROLES };
