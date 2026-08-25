/**
 * auth.js
 * -------
 * Two separate checks happen on every login:
 *   1. Google verifies the person really is who the token claims, and that
 *      they're on the @zazzle.com domain (enforced by the "Internal" OAuth
 *      consent screen setting in Google Cloud Console).
 *   2. We separately check our own allowlist (userStore) — being a Zazzle
 *      employee doesn't automatically mean being allowed into this specific
 *      tool.
 * Once both pass, we issue our OWN short-lived session token (a JWT) that
 * the frontend attaches to every subsequent request.
 */

const { OAuth2Client } = require("google-auth-library");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const userStore = require("./userStore");

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const ALLOWED_DOMAIN = process.env.ALLOWED_DOMAIN || "zazzle.com";

// IMPORTANT: no hardcoded fallback secret. This code lives in a public repo
// — a fallback string here would mean anyone reading the source could forge
// a valid session for any email. If SESSION_SECRET isn't set via env var,
// generate a random one at startup instead: safe (nobody can predict it),
// with the honest tradeoff that everyone gets logged out if the process
// restarts without SESSION_SECRET configured. Set it in Render's env vars
// to avoid that.
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");
if (!process.env.SESSION_SECRET) {
  console.warn(
    "WARNING: SESSION_SECRET is not set — using a random secret for this process only. " +
    "Everyone will be logged out on every restart/redeploy until you set SESSION_SECRET in your environment."
  );
}

const client = new OAuth2Client(GOOGLE_CLIENT_ID);

// Shared by both Google sign-in and self-service signup — one place
// defining "who's allowed to even attempt creating an account here."
function isAllowedDomain(email) {
  const domain = (String(email).split("@")[1] || "").toLowerCase();
  return domain === ALLOWED_DOMAIN.toLowerCase();
}

async function verifyGoogleToken(idToken) {
  if (!GOOGLE_CLIENT_ID) {
    throw new Error("Server is not configured with GOOGLE_CLIENT_ID yet");
  }
  const ticket = await client.verifyIdToken({ idToken, audience: GOOGLE_CLIENT_ID });
  const payload = ticket.getPayload();
  if (!payload.email_verified) throw new Error("Google reports this email is not verified");
  if (!isAllowedDomain(payload.email)) {
    throw new Error(`Only @${ALLOWED_DOMAIN} accounts are allowed`);
  }
  return { email: payload.email.toLowerCase(), name: payload.name || payload.email };
}

function issueSessionToken(user) {
  return jwt.sign({ email: user.email, name: user.name }, SESSION_SECRET, { expiresIn: "12h" });
}

function verifySessionToken(token) {
  return jwt.verify(token, SESSION_SECRET);
}

// Express middleware — protects a route. On success, req.user = { email, name }.
function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Not logged in" });
  try {
    req.user = verifySessionToken(token);
    next();
  } catch (err) {
    res.status(401).json({ error: "Session expired or invalid — please log in again" });
  }
}

// Stricter than requireAuth — also checks the CURRENT admin status fresh
// from userStore (not just what was true when the session was issued), so
// revoking someone's admin rights takes effect immediately rather than
// waiting for their session to expire. Chain after requireAuth.
function requireAdmin(req, res, next) {
  if (!userStore.isAdmin(req.user.email)) {
    return res.status(403).json({ error: "Only admins can do this" });
  }
  next();
}

module.exports = { verifyGoogleToken, issueSessionToken, verifySessionToken, requireAuth, requireAdmin, isAllowedDomain };
