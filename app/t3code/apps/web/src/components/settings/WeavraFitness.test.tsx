import { AsyncResult } from "effect/unstable/reactivity";
import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import type { ComponentProps, PropsWithChildren } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@t3tools/client-runtime/state/weavraFitness", () => ({
  createEnvironmentWeavraFitnessCommand: () => ({}),
}));
vi.mock("../../connection/runtime", () => ({ connectionAtomRuntime: {} }));
vi.mock("../../state/environments", () => ({
  useEnvironment: () => ({ connection: { phase: "connected" } }),
}));
vi.mock("../../state/use-atom-command", () => ({ useAtomCommand: () => mocks.invoke }));
vi.mock("../ui/badge", () => ({
  Badge: (props: ComponentProps<"span">) => <span {...props} />,
}));
vi.mock("../ui/button", () => ({
  Button: ({ variant, size, ...props }: ComponentProps<"button"> & Record<string, unknown>) => (
    <button data-variant={String(variant)} data-size={String(size)} {...props} />
  ),
}));
vi.mock("./SettingsGroup", () => ({
  SettingsGroup: ({ children }: PropsWithChildren) => <div>{children}</div>,
}));
vi.mock("./settingsLayout", () => ({
  SettingsSection: ({ children }: PropsWithChildren) => <section>{children}</section>,
}));
import { WeavraFitness } from "./WeavraFitness";

let renderer: ReactTestRenderer;
const text = () => JSON.stringify(renderer.toJSON());
const buttons = () => renderer.root.findAllByType("button");
const named = (label: string) =>
  buttons().filter((node) => JSON.stringify(node.props.children).includes(label));

beforeEach(() => {
  mocks.invoke.mockReset().mockResolvedValue(
    AsyncResult.success({
      command: "list",
      data: { corpusRevision: "r1", corpusDigest: "d1", fixtures: [], runs: [] },
    }),
  );
  act(() => {
    renderer = create(
      <WeavraFitness
        environmentId={EnvironmentId.make("env")}
        projectId={ProjectId.make("project")}
      />,
    );
  });
});
afterEach(() => {
  act(() => renderer.unmount());
});

it("says up front that records are only read and that evaluation needs separate approval", () => {
  expect(text()).toContain("별도로 명시적인 승인");
  expect(named("평가 시작")).toHaveLength(0);
  expect(named("Evaluate")).toHaveLength(0);
});

it("explains the record workflow in a disclosure that issues no request", () => {
  const [help] = named("읽기 전용 안내");
  expect(help!.props["aria-expanded"]).toBe(false);
  expect(text()).not.toContain("기록 목록을 읽어요");
  act(() => help!.props.onClick());
  expect(named("읽기 전용 안내")[0]!.props["aria-expanded"]).toBe(true);
  expect(text()).toContain("기록 목록을 읽어요");
  expect(mocks.invoke).not.toHaveBeenCalled();
  act(() => named("읽기 전용 안내")[0]!.props.onKeyDown({ key: "Escape" }));
  expect(named("읽기 전용 안내")[0]!.props["aria-expanded"]).toBe(false);
  expect(text()).not.toContain("기록 목록을 읽어요");
});

it("loads records with one read-only list request and explains an empty result", async () => {
  await act(async () => {
    named("기록 불러오기")[0]!.props.onClick();
  });
  expect(mocks.invoke).toHaveBeenCalledTimes(1);
  expect(mocks.invoke).toHaveBeenCalledWith({
    environmentId: "env",
    input: { projectId: "project", command: "list" },
  });
  expect(text()).toContain("읽을 적합성 기록이 아직 없어요");
  expect(text()).toContain("별도로 승인을 받아야 하고");
});
