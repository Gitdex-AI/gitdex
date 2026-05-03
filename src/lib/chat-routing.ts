import type { Role } from "@/lib/types";

export type ChatTargetRole = Extract<Role, "product_manager" | "architect" | "devops">;

const mentionTargets: Record<string, ChatTargetRole> = {
  pm: "product_manager",
  product_manager: "product_manager",
  productmanager: "product_manager",
  architect: "architect",
  arch: "architect",
  devops: "devops",
  ops: "devops"
};

export function parseChatTarget(input: string): { role: ChatTargetRole; message: string; mention: string | null } {
  const trimmed = input.trim();
  const match = trimmed.match(/^@([a-zA-Z_][\w-]*)\b\s*/);
  if (!match) return { role: "product_manager", message: trimmed, mention: null };

  const mention = match[1].toLowerCase();
  const role = mentionTargets[mention];
  if (!role) return { role: "product_manager", message: trimmed, mention: match[1] };

  const message = trimmed.slice(match[0].length).trim();
  return { role, message, mention: match[1] };
}

export function chatRoleLabel(role: Role, title?: string | null, developerRole?: string | null): string {
  if (role === "product_manager") return "PM";
  if (role === "planner") return "Planner";
  if (role === "architect") return "Architect";
  if (role === "reviewer") return "Reviewer";
  if (role === "devops") return "DevOps";
  if (role === "qa") return title && title !== "QA" ? (title.toLowerCase().startsWith("qa") ? title : `QA: ${title}`) : "QA";
  if (role === "developer") return developerRole ? `Developer: ${developerRole}` : title ? `Developer: ${title}` : "Developer";
  return title ?? "System";
}
