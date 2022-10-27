import { flushPromises } from "@jspsych/test-utils";
import { mocked } from "ts-jest/utils";

import { TimelineNodeDependenciesMock } from "../../tests/test-utils";
import TestPlugin from "../../tests/TestPlugin";
import { ParameterType } from "../modules/plugins";
import { Timeline } from "./Timeline";
import { Trial } from "./Trial";
import { parameterPathArrayToString } from "./util";
import { TimelineVariable, TrialDescription } from ".";

jest.useFakeTimers();

jest.mock("./Timeline");

const dependencies = new TimelineNodeDependenciesMock();

describe("Trial", () => {
  let timeline: Timeline;

  beforeEach(() => {
    dependencies.reset();
    TestPlugin.reset();

    timeline = new Timeline(dependencies, { timeline: [] });
    timeline.index = 0;
  });

  const createTrial = (description: TrialDescription) => {
    const trial = new Trial(dependencies, description, timeline);
    trial.index = timeline.index;
    return trial;
  };

  describe("run()", () => {
    it("instantiates the corresponding plugin", async () => {
      const trial = createTrial({ type: TestPlugin });

      await trial.run();

      expect(trial.pluginInstance).toBeInstanceOf(TestPlugin);
    });

    it("invokes the local `on_start` and the global `onTrialStart` callback", async () => {
      const onStartCallback = jest.fn();
      const description = { type: TestPlugin, on_start: onStartCallback };
      const trial = createTrial(description);
      await trial.run();

      expect(onStartCallback).toHaveBeenCalledTimes(1);
      expect(onStartCallback).toHaveBeenCalledWith(description);
      expect(dependencies.onTrialStart).toHaveBeenCalledTimes(1);
      expect(dependencies.onTrialStart).toHaveBeenCalledWith(trial);
    });

    it("properly invokes the plugin's `trial` method", async () => {
      const trialMethodSpy = jest.spyOn(TestPlugin.prototype, "trial");
      const trial = createTrial({ type: TestPlugin });

      await trial.run();

      expect(trialMethodSpy).toHaveBeenCalledTimes(1);
      expect(trialMethodSpy).toHaveBeenCalledWith(
        expect.any(HTMLElement),
        { type: TestPlugin },
        expect.any(Function)
      );
    });

    it("accepts changes to the trial description made by the `on_start` callback", async () => {
      const onStartCallback = jest.fn();
      const description = { type: TestPlugin, on_start: onStartCallback };

      onStartCallback.mockImplementation((trial) => {
        // We should have a writeable copy here, not the original trial description:
        expect(trial).not.toBe(description);
        trial.stimulus = "changed";
      });

      const trial = createTrial(description);
      await trial.run();

      expect(trial.pluginInstance.trial).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ stimulus: "changed" }),
        expect.anything()
      );
    });

    describe("if `trial` returns a promise", () => {
      it("doesn't automatically invoke the `on_load` callback", async () => {
        const onLoadCallback = jest.fn();
        const trial = createTrial({ type: TestPlugin, on_load: onLoadCallback });

        await trial.run();

        // TestPlugin invokes the callback for us in the `trial` method
        expect(onLoadCallback).toHaveBeenCalledTimes(1);
      });

      it("picks up the result data from the promise or the `finishTrial()` function (where the latter one takes precedence)", async () => {
        const trial1 = createTrial({ type: TestPlugin });
        await trial1.run();
        expect(trial1.getResult()).toEqual(expect.objectContaining({ my: "result" }));

        jest
          .spyOn(TestPlugin.prototype, "trial")
          .mockImplementation(async (display_element, trial, on_load) => {
            on_load();
            dependencies.finishTrialPromise.resolve({ finishTrial: "result" });
            return { my: "result" };
          });

        const trial2 = createTrial({ type: TestPlugin });
        await trial2.run();
        expect(trial2.getResult()).toEqual(expect.objectContaining({ finishTrial: "result" }));
      });
    });

    describe("if `trial` returns no promise", () => {
      beforeAll(() => {
        TestPlugin.prototype.trial.mockImplementation(() => {
          dependencies.finishTrialPromise.resolve({ my: "result" });
        });
      });

      it("invokes the local `on_load` and the global `onTrialLoaded` callback", async () => {
        const onLoadCallback = jest.fn();
        const trial = createTrial({ type: TestPlugin, on_load: onLoadCallback });
        await trial.run();

        expect(onLoadCallback).toHaveBeenCalledTimes(1);
        expect(dependencies.onTrialLoaded).toHaveBeenCalledTimes(1);
      });

      it("picks up the result data from the `finishTrial()` function", async () => {
        const trial = createTrial({ type: TestPlugin });

        await trial.run();
        expect(trial.getResult()).toEqual(expect.objectContaining({ my: "result" }));
      });
    });

    it("invokes the local `on_finish` callback with the result data", async () => {
      const onFinishCallback = jest.fn();
      const trial = createTrial({ type: TestPlugin, on_finish: onFinishCallback });
      await trial.run();

      expect(onFinishCallback).toHaveBeenCalledTimes(1);
      expect(onFinishCallback).toHaveBeenCalledWith(expect.objectContaining({ my: "result" }));
    });

    it("invokes the global `onTrialResultAvailable` and `onTrialFinished` callbacks", async () => {
      const invocations: string[] = [];
      dependencies.onTrialResultAvailable.mockImplementationOnce(() => {
        invocations.push("onTrialResultAvailable");
      });
      dependencies.onTrialFinished.mockImplementationOnce(() => {
        invocations.push("onTrialFinished");
      });

      const trial = createTrial({ type: TestPlugin });
      await trial.run();

      expect(dependencies.onTrialResultAvailable).toHaveBeenCalledTimes(1);
      expect(dependencies.onTrialResultAvailable).toHaveBeenCalledWith(trial);

      expect(dependencies.onTrialFinished).toHaveBeenCalledTimes(1);
      expect(dependencies.onTrialFinished).toHaveBeenCalledWith(trial);

      expect(invocations).toEqual(["onTrialResultAvailable", "onTrialFinished"]);
    });

    it("includes result data from the `data` parameter", async () => {
      const trial = createTrial({ type: TestPlugin, data: { custom: "value" } });
      await trial.run();
      expect(trial.getResult()).toEqual(expect.objectContaining({ my: "result", custom: "value" }));
    });

    it("includes a set of trial-specific result properties", async () => {
      const trial = createTrial({ type: TestPlugin });
      await trial.run();
      expect(trial.getResult()).toEqual(
        expect.objectContaining({ trial_type: "test", trial_index: 0 })
      );
    });

    it("respects the `save_trial_parameters` parameter", async () => {
      const consoleSpy = jest.spyOn(console, "warn").mockImplementation();

      TestPlugin.setParameterInfos({
        stringParameter1: { type: ParameterType.STRING },
        stringParameter2: { type: ParameterType.STRING },
        stringParameter3: { type: ParameterType.STRING },
        stringParameter4: { type: ParameterType.STRING },
        complexArrayParameter: { type: ParameterType.COMPLEX, array: true },
        functionParameter: { type: ParameterType.FUNCTION },
      });
      TestPlugin.setDefaultTrialResult({
        result: "foo",
        stringParameter2: "string",
        stringParameter3: "string",
      });
      const trial = createTrial({
        type: TestPlugin,
        stringParameter1: "string",
        stringParameter2: "string",
        stringParameter3: "string",
        stringParameter4: "string",
        functionParameter: jest.fn(),
        complexArrayParameter: [{ child: "foo" }, () => ({ child: "bar" })],

        save_trial_parameters: {
          stringParameter3: false,
          stringParameter4: true,
          functionParameter: true,
          complexArrayParameter: true,
          result: false, // Since `result` is not a parameter, this should be ignored
        },
      });
      await trial.run();
      const result = trial.getResult();

      // By default, parameters should not be added:
      expect(result).not.toHaveProperty("stringParameter1");

      // If the plugin adds them, they should not be removed either:
      expect(result).toHaveProperty("stringParameter2", "string");

      // When explicitly set to false, parameters should be removed if the plugin adds them
      expect(result).not.toHaveProperty("stringParameter3");

      // When set to true, parameters should be added
      expect(result).toHaveProperty("stringParameter4", "string");

      // Function parameters should be stringified
      expect(result).toHaveProperty("functionParameter", jest.fn().toString());

      // Non-parameter data should be left untouched and a warning should be issued
      expect(result).toHaveProperty("result", "foo");
      expect(consoleSpy).toHaveBeenCalledTimes(1);
      expect(consoleSpy).toHaveBeenCalledWith(
        'Non-existent parameter "result" specified in save_trial_parameters.'
      );
      consoleSpy.mockRestore();
    });

    describe("with a plugin parameter specification", () => {
      const functionDefaultValue = () => {};
      beforeEach(() => {
        TestPlugin.setParameterInfos({
          string: { type: ParameterType.STRING, default: null },
          requiredString: { type: ParameterType.STRING },
          stringArray: { type: ParameterType.STRING, default: [], array: true },
          function: { type: ParameterType.FUNCTION, default: functionDefaultValue },
          complex: { type: ParameterType.COMPLEX, default: {} },
          requiredComplexNested: {
            type: ParameterType.COMPLEX,
            nested: {
              child: { type: ParameterType.STRING, default: "I'm nested." },
              requiredChild: { type: ParameterType.STRING },
            },
          },
          requiredComplexNestedArray: {
            type: ParameterType.COMPLEX,
            array: true,
            nested: {
              child: { type: ParameterType.STRING, default: "I'm nested." },
              requiredChild: { type: ParameterType.STRING },
            },
          },
        });
      });

      it("resolves missing parameter values from parent timeline and sets default values", async () => {
        mocked(timeline).getParameterValue.mockImplementation((parameterPath) => {
          if (Array.isArray(parameterPath)) {
            parameterPath = parameterPathArrayToString(parameterPath);
          }

          if (parameterPath === "requiredString") {
            return "foo";
          }
          if (parameterPath === "requiredComplexNestedArray[0].requiredChild") {
            return "foo";
          }
          return undefined;
        });
        const trial = createTrial({
          type: TestPlugin,
          requiredComplexNested: { requiredChild: "bar" },
          requiredComplexNestedArray: [
            // This empty object is allowed because `requiredComplexNestedArray[0]` is (simulated to
            // be) set as a parameter to the mocked parent timeline:
            {},
            { requiredChild: "bar" },
          ],
        });

        await trial.run();

        // `requiredString` should have been resolved from the parent timeline
        expect(trial.pluginInstance.trial).toHaveBeenCalledWith(
          expect.anything(),
          {
            type: TestPlugin,
            string: null,
            requiredString: "foo",
            stringArray: [],
            function: functionDefaultValue,
            complex: {},
            requiredComplexNested: { child: "I'm nested.", requiredChild: "bar" },
            requiredComplexNestedArray: [
              { child: "I'm nested.", requiredChild: "foo" },
              { child: "I'm nested.", requiredChild: "bar" },
            ],
          },
          expect.anything()
        );
      });

      it("errors when an `array` parameter is not an array", async () => {
        TestPlugin.setParameterInfos({
          stringArray: { type: ParameterType.STRING, array: true },
        });

        // This should work:
        await createTrial({ type: TestPlugin, stringArray: [] }).run();

        // This shouldn't:
        await expect(
          createTrial({ type: TestPlugin, stringArray: {} }).run()
        ).rejects.toThrowErrorMatchingInlineSnapshot(
          '"A non-array value (`[object Object]`) was provided for the array parameter \\"stringArray\\" in the \\"test\\" plugin. Please make sure that \\"stringArray\\" is an array."'
        );
        await expect(
          createTrial({ type: TestPlugin, stringArray: 1 }).run()
        ).rejects.toThrowErrorMatchingInlineSnapshot(
          '"A non-array value (`1`) was provided for the array parameter \\"stringArray\\" in the \\"test\\" plugin. Please make sure that \\"stringArray\\" is an array."'
        );
      });

      it("evaluates parameter functions", async () => {
        const functionParameter = () => "invalid";
        const trial = createTrial({
          type: TestPlugin,
          function: functionParameter,
          requiredString: () => "foo",
          requiredComplexNested: () => ({
            requiredChild: () => "bar",
          }),
          requiredComplexNestedArray: () => [() => ({ requiredChild: () => "bar" })],
        });

        await trial.run();

        expect(trial.pluginInstance.trial).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({
            function: functionParameter,
            requiredString: "foo",
            requiredComplexNested: expect.objectContaining({ requiredChild: "bar" }),
            requiredComplexNestedArray: [expect.objectContaining({ requiredChild: "bar" })],
          }),
          expect.anything()
        );
      });

      it("evaluates timeline variables, including those returned from parameter functions", async () => {
        mocked(timeline).evaluateTimelineVariable.mockImplementation(
          (variable: TimelineVariable) => {
            switch (variable.name) {
              case "t":
                return TestPlugin;
              case "x":
                return "foo";
              default:
                return undefined;
            }
          }
        );

        const trial = createTrial({
          type: new TimelineVariable("t"),
          requiredString: new TimelineVariable("x"),
          requiredComplexNested: { requiredChild: () => new TimelineVariable("x") },
          requiredComplexNestedArray: [{ requiredChild: () => new TimelineVariable("x") }],
        });

        await trial.run();

        // The `x` timeline variables should have been replaced with `foo`
        expect(trial.pluginInstance.trial).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({
            requiredString: "foo",
            requiredComplexNested: expect.objectContaining({ requiredChild: "foo" }),
            requiredComplexNestedArray: [expect.objectContaining({ requiredChild: "foo" })],
          }),
          expect.anything()
        );
      });

      describe("with missing required parameters", () => {
        it("errors on missing simple parameters", async () => {
          TestPlugin.setParameterInfos({ requiredString: { type: ParameterType.STRING } });

          // This should work:
          await createTrial({ type: TestPlugin, requiredString: "foo" }).run();

          // This shouldn't:
          await expect(createTrial({ type: TestPlugin }).run()).rejects.toThrow(
            '"requiredString" parameter'
          );
        });

        it("errors on missing parameters nested in `COMPLEX` parameters", async () => {
          TestPlugin.setParameterInfos({
            requiredComplexNested: {
              type: ParameterType.COMPLEX,
              nested: { requiredChild: { type: ParameterType.STRING } },
            },
          });

          // This should work:
          await createTrial({
            type: TestPlugin,
            requiredComplexNested: { requiredChild: "bar" },
          }).run();

          // This shouldn't:
          await expect(createTrial({ type: TestPlugin }).run()).rejects.toThrow(
            '"requiredComplexNested" parameter'
          );
          await expect(
            createTrial({ type: TestPlugin, requiredComplexNested: {} }).run()
          ).rejects.toThrowError('"requiredComplexNested.requiredChild" parameter');
        });

        it("errors on missing parameters nested in `COMPLEX` array parameters", async () => {
          TestPlugin.setParameterInfos({
            requiredComplexNestedArray: {
              type: ParameterType.COMPLEX,
              array: true,
              nested: { requiredChild: { type: ParameterType.STRING } },
            },
          });

          // This should work:
          await createTrial({ type: TestPlugin, requiredComplexNestedArray: [] }).run();
          await createTrial({
            type: TestPlugin,
            requiredComplexNestedArray: [{ requiredChild: "bar" }],
          }).run();

          // This shouldn't:
          await expect(createTrial({ type: TestPlugin }).run()).rejects.toThrow(
            '"requiredComplexNestedArray" parameter'
          );
          await expect(
            createTrial({ type: TestPlugin, requiredComplexNestedArray: [{}] }).run()
          ).rejects.toThrow('"requiredComplexNestedArray[0].requiredChild" parameter');
          await expect(
            createTrial({
              type: TestPlugin,
              requiredComplexNestedArray: [{ requiredChild: "bar" }, {}],
            }).run()
          ).rejects.toThrow('"requiredComplexNestedArray[1].requiredChild" parameter');
        });
      });
    });

    it("respects `default_iti` and `post_trial_gap``", async () => {
      dependencies.getDefaultIti.mockReturnValue(100);
      TestPlugin.setManualFinishTrialMode();

      const trial1 = createTrial({ type: TestPlugin });

      const runPromise1 = trial1.run();
      let hasTrial1Completed = false;
      runPromise1.then(() => {
        hasTrial1Completed = true;
      });

      await TestPlugin.finishTrial();
      expect(hasTrial1Completed).toBe(false);

      jest.advanceTimersByTime(100);
      await flushPromises();
      expect(hasTrial1Completed).toBe(true);

      const trial2 = createTrial({ type: TestPlugin, post_trial_gap: () => 200 });

      const runPromise2 = trial2.run();
      let hasTrial2Completed = false;
      runPromise2.then(() => {
        hasTrial2Completed = true;
      });

      await TestPlugin.finishTrial();
      expect(hasTrial2Completed).toBe(false);

      jest.advanceTimersByTime(100);
      await flushPromises();
      expect(hasTrial2Completed).toBe(false);

      jest.advanceTimersByTime(100);
      await flushPromises();
      expect(hasTrial2Completed).toBe(true);
    });
  });

  describe("getResult[s]()", () => {
    it("returns the result once it is available", async () => {
      TestPlugin.setManualFinishTrialMode();
      const trial = createTrial({ type: TestPlugin });
      trial.run();

      expect(trial.getResult()).toBeUndefined();
      expect(trial.getResults()).toEqual([]);

      await TestPlugin.finishTrial();

      expect(trial.getResult()).toEqual(expect.objectContaining({ my: "result" }));
      expect(trial.getResults()).toEqual([expect.objectContaining({ my: "result" })]);
    });
  });

  describe("evaluateTimelineVariable()", () => {
    it("defers to the parent node", () => {
      mocked(timeline).evaluateTimelineVariable.mockReturnValue(1);

      const trial = new Trial(dependencies, { type: TestPlugin }, timeline);

      const variable = new TimelineVariable("x");
      expect(trial.evaluateTimelineVariable(variable)).toEqual(1);
      expect(timeline.evaluateTimelineVariable).toHaveBeenCalledWith(variable);
    });
  });

  describe("getParameterValue()", () => {
    it("disables recursive lookups of timeline description keys", async () => {
      const trial = createTrial({ type: TestPlugin });

      for (const parameter of [
        "timeline",
        "timeline_variables",
        "repetitions",
        "loop_function",
        "conditional_function",
        "randomize_order",
        "sample",
        "on_timeline_start",
        "on_timeline_finish",
      ]) {
        expect(trial.getParameterValue(parameter)).toBeUndefined();
        expect(timeline.getParameterValue).not.toHaveBeenCalled();
      }
    });
  });
});
