import type { Profile } from "./types";

export type AssignmentFilters = {
  name: string;
  state: string;
  costCenter: string;
  job: string;
  professionalFunction?: string;
};
export const emptyAssignmentFilters: AssignmentFilters = {
  name: "",
  state: "",
  costCenter: "",
  job: "",
  professionalFunction: "",
};
const clean = (value?: string | null) =>
  (value ?? "").trim().replace(/\s+/g, " ");
const normalize = (value?: string | null) =>
  clean(value).toLocaleLowerCase("pt-BR");
const searchName = (value: string) =>
  normalize(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
const eligible = (user: Profile) => user.active && user.role === "manager";
export function toggleAssignmentUsers(
  selected: string[],
  visible: Profile[],
  assigned: string[],
) {
  const selectable = visible
    .filter((user) => eligible(user) && !assigned.includes(user.id))
    .map((user) => user.id);
  if (selectable.length && selectable.every((id) => selected.includes(id))) {
    return selected.filter((id) => !selectable.includes(id));
  }
  return selectAllAssignmentUsers(selected, visible, assigned);
}
export function selectAllAssignmentUsers(
  selected: string[],
  visible: Profile[],
  assigned: string[],
) {
  return [
    ...new Set([
      ...selected,
      ...visible
        .filter((user) => eligible(user) && !assigned.includes(user.id))
        .map((user) => user.id),
    ]),
  ];
}
const matches = (value: string, filter: string) =>
  !filter || (filter === "__missing__" ? !value : value === filter);

export function assignmentOptions(
  users: Profile[],
  field: "state" | "cost_center" | "professional_function",
) {
  const options = new Map<string, string>();
  users.filter(eligible).forEach((user) => {
    const value = normalize(user[field]);
    if (value && !options.has(value))
      options.set(
        value,
        field === "state"
          ? clean(user[field]).toUpperCase()
          : clean(user[field]),
      );
  });
  return [...options]
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
}

export function filterAssignmentUsers(
  users: Profile[],
  filters: AssignmentFilters,
) {
  return users.filter(
    (user) =>
      eligible(user) &&
      searchName(user.name).includes(searchName(filters.name)) &&
      matches(normalize(user.state), filters.state) &&
      matches(normalize(user.cost_center), filters.costCenter) &&
      matches(user.job_id ?? "", filters.job) &&
      matches(
        normalize(user.professional_function),
        filters.professionalFunction ?? "",
      ),
  );
}
