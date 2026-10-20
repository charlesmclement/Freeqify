/** Small, reviewable local denylist, not a claim to contain all breached passwords.
 * Extend this list during security reviews; optional local SHA-1 corpus adds coverage.
 * Hashes in that corpus are lookup fingerprints only, never password storage hashes.
 */
export const weakPasswords = new Set([
 'password','passwordpassword','passwordpasswordpassword','password123456789','123456789012345','12345678901234567890',
 'qwerty','qwertyuiop','qwertyuiopasdfghjkl','letmein','letmeinletmein','iloveyou','iloveyouiloveyou',
 'admin','administrator','welcome','welcomewelcome','changeme','changemechangeme','correcthorsebatterystaple',
 'trustno1','monkey','dragon','football','sunshine','princess','secret','default','freeqify','navidrome',
]);
