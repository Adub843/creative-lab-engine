// Every maker in the studio, grouped the way the left rail shows them.
import keychain from "./keychain.js";

export const GROUPS = [
  { title: "Names and text", makers: [keychain] },
];

export const MAKERS = GROUPS.flatMap((g) => g.makers);
