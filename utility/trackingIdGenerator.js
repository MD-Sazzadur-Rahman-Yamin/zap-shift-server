// Change import crypto from "crypto";
const crypto = require("crypto");

// Change export function generateTrackingId() {
function generateTrackingId() {
  // Get current date in YYYYMMDD format
  const date = new Date();
  const dateStr =
    date.getFullYear().toString() +
    String(date.getMonth() + 1).padStart(2, "0") +
    String(date.getDate()).padStart(2, "0");

  // Generate random 4-byte hex string
  const random = crypto.randomBytes(4).toString("hex").toUpperCase();

  // Combine date + random for tracking ID
  return `TRK-${dateStr}-${random}`;
}

// Export the function using CommonJS
module.exports = {
  generateTrackingId,
};
