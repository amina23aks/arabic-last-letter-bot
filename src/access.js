export const isUserId = id => Number.isSafeInteger(id) && id > 0;

function parseIds(value, pattern) {
  if (typeof value !== "string") return [];
  const ids = value.split(",").map(id => id.trim());
  if (!ids.every(id => pattern.test(id) && Number.isSafeInteger(Number(id)))) return [];
  return ids.map(Number);
}

export function groupAccess(env) {
  const owners = new Set(parseIds(env.ADMIN_USER_IDS, /^[1-9]\d*$/));
  const groups = new Set(parseIds(env.APPROVED_GROUP_IDS, /^-[1-9]\d*$/));
  if (owners.size !== 3 || env.ADMIN_USER_IDS.split(",").length !== 3 ||
    (env.APPROVED_GROUP_IDS && groups.size === 0)) return null;
  return { owners, groups };
}

export function isGroupMember(member) {
  return ["member", "administrator", "creator"].includes(member?.status) ||
    (member?.status === "restricted" && member.is_member === true);
}
