export type DeviceClass = "mobile" | "tablet" | "desktop";

const TABLET = /ipad|tablet|kindle|silk|playbook|nexus 7|nexus 9/i;
const MOBILE = /mobile|iphone|ipod|android.*mobile|windows phone|blackberry|opera mini/i;

export function classifyDevice(userAgent: string | null | undefined): DeviceClass {
  if (!userAgent) return "desktop";
  if (TABLET.test(userAgent)) return "tablet";
  if (MOBILE.test(userAgent)) return "mobile";
  return "desktop";
}
