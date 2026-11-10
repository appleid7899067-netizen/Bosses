import config from "../../skills/skills_config.json";

export type SkillCategory = "engineering" | "integrations" | "design" | "quality";

export type SkillDefinition = {
  name: string;
  description: string;
  enabled: boolean;
  category: SkillCategory;
};

export const SKILLS = Object.values(config) as SkillDefinition[];

export function getEnabledSkills(): SkillDefinition[] {
  return SKILLS.filter((skill) => skill.enabled);
}

export function getSkill(name: string): SkillDefinition | undefined {
  return SKILLS.find((skill) => skill.name === name && skill.enabled);
}

export function summarizeSkills(): string {
  return getEnabledSkills()
    .map((skill) => `- ${skill.name}: ${skill.description}`)
    .join("\n");
}
