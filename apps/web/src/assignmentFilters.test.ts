import { expect, it } from "vitest";
import {
  assignmentOptions,
  filterAssignmentUsers,
  selectAllAssignmentUsers,
  toggleAssignmentUsers,
} from "./assignmentFilters";
import type { Profile } from "./types";

const users: Profile[] = [
  {
    id: "1",
    name: "João Silva",
    email: "",
    role: "manager",
    active: true,
    state: " PE ",
    cost_center: "Obra   Norte",
    job_id: "a",
  },
  {
    id: "2",
    name: "Maria",
    email: "",
    role: "manager",
    active: true,
    state: "pe",
    cost_center: "obra norte",
    job_id: "b",
  },
  { id: "3", name: "Sem cadastro", email: "", role: "manager", active: true },
  {
    id: "4",
    name: "Inativo",
    email: "",
    role: "manager",
    active: false,
    state: "SP",
  },
  {
    id: "5",
    name: "Admin",
    email: "",
    role: "admin",
    active: true,
    state: "RJ",
  },
];
const filters = { name: "", state: "", costCenter: "", job: "" };

it("toggles the filtered selection while preserving hidden users and assigned users", () => {
  expect(toggleAssignmentUsers(["outside", "2"], users, ["1"])).toEqual([
    "outside",
    "2",
    "3",
  ]);
  expect(toggleAssignmentUsers(["outside", "2", "3"], users, ["1"])).toEqual([
    "outside",
  ]);
  expect(toggleAssignmentUsers(["outside"], [], [])).toEqual(["outside"]);
  expect(toggleAssignmentUsers(["outside"], [users[0]], ["1"])).toEqual([
    "outside",
  ]);
});

it("selects only visible eligible unassigned users and preserves previous selections without duplicates", () => {
  expect(selectAllAssignmentUsers(["outside", "2"], users, ["1"])).toEqual([
    "outside",
    "2",
    "3",
  ]);
  expect(selectAllAssignmentUsers(["outside"], [], [])).toEqual(["outside"]);
});

it("deduplicates normalized options from eligible users only", () => {
  expect(assignmentOptions(users, "state")).toEqual([
    { value: "pe", label: "PE" },
  ]);
  expect(assignmentOptions(users, "cost_center")).toEqual([
    { value: "obra norte", label: "Obra Norte" },
  ]);
});
it("combines all filters and searches names without accents or case", () => {
  expect(
    filterAssignmentUsers(users, {
      name: " JOAO ",
      state: "pe",
      costCenter: "obra norte",
      job: "a",
    }).map((u) => u.id),
  ).toEqual(["1"]);
  expect(
    filterAssignmentUsers(users, { ...filters, name: "joao", job: "b" }),
  ).toEqual([]);
});
it("supports missing fields and excludes inactive users and admins", () => {
  expect(filterAssignmentUsers(users, filters).map((u) => u.id)).toEqual([
    "1",
    "2",
    "3",
  ]);
  expect(
    filterAssignmentUsers(users, {
      name: "",
      state: "__missing__",
      costCenter: "__missing__",
      job: "__missing__",
    }).map((u) => u.id),
  ).toEqual(["3"]);
});

it("filters professional function independently from registered job and deduplicates functions", () => {
  const people = users.slice(0, 2).map((user) => ({
    ...user,
    professional_function: user.id === "1" ? " Técnico " : "técnico",
  }));
  expect(assignmentOptions(people, "professional_function")).toEqual([
    { value: "técnico", label: "Técnico" },
  ]);
  expect(
    filterAssignmentUsers(people, {
      ...filters,
      job: "a",
      professionalFunction: "técnico",
    }).map((user) => user.id),
  ).toEqual(["1"]);
  expect(
    filterAssignmentUsers(people, {
      ...filters,
      professionalFunction: "outra",
    }),
  ).toEqual([]);
});
