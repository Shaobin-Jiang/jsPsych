import { Class } from "type-fest";

import { JsPsychPlugin, PluginInfo } from "../modules/plugins";
import { Trial } from "./Trial";
import { PromiseWrapper } from "./util";

export function isPromise(value: any): value is Promise<any> {
  return value && typeof value["then"] === "function";
}

export class TimelineVariable {
  constructor(public readonly name: string) {}
}

export type Parameter<T> = T | (() => T) | TimelineVariable;

export interface TrialDescription extends Record<string, any> {
  type: Parameter<Class<JsPsychPlugin<any>>>;

  /** https://www.jspsych.org/latest/overview/plugins/#the-post_trial_gap-iti-parameter */
  post_trial_gap?: Parameter<number>;

  /** https://www.jspsych.org/latest/overview/style/#using-the-css_classes-trial-parameter */
  css_classes?: Parameter<string | string[]>;

  /** https://www.jspsych.org/latest/overview/simulation/#controlling-simulation-mode-with-simulation_options */
  simulation_options?: Parameter<any>;

  // Events

  /** https://www.jspsych.org/latest/overview/events/#on_start-trial */
  on_start?: (trial: any) => void;

  /** https://www.jspsych.org/latest/overview/events/#on_load */
  on_load?: () => void;

  /** https://www.jspsych.org/latest/overview/events/#on_finish-trial */
  on_finish?: (data: any) => void;
}

/** https://www.jspsych.org/latest/overview/timeline/#sampling-methods */
export type SampleOptions =
  | { type: "with-replacement"; size: number; weights?: number[] }
  | { type: "without-replacement"; size: number }
  | { type: "fixed-repetitions"; size: number }
  | { type: "alternate-groups"; groups: number[][]; randomize_group_order?: boolean }
  | { type: "custom"; fn: (ids: number[]) => number[] };

export type TimelineArray = Array<TimelineDescription | TrialDescription | TimelineArray>;

export interface TimelineDescription extends Record<string, any> {
  timeline: TimelineArray;
  timeline_variables?: Record<string, any>[];

  // Control flow

  /** https://www.jspsych.org/latest/overview/timeline/#repeating-a-set-of-trials */
  repetitions?: number;

  /** https://www.jspsych.org/latest/overview/timeline/#looping-timelines */
  loop_function?: (data: any) => boolean;

  /** https://www.jspsych.org/latest/overview/timeline/#conditional-timelines */
  conditional_function?: () => boolean;

  // Randomization

  /** https://www.jspsych.org/latest/overview/timeline/#random-orders-of-trials */
  randomize_order?: boolean;

  /** https://www.jspsych.org/latest/overview/timeline/#sampling-methods */
  sample?: SampleOptions;

  // Events

  /** https://www.jspsych.org/latest/overview/events/#on_timeline_start */
  on_timeline_start?: () => void;

  /** https://www.jspsych.org/latest/overview/events/#on_timeline_finish */
  on_timeline_finish?: () => void;
}

export const timelineDescriptionKeys = [
  "timeline",
  "timeline_variables",
  "repetitions",
  "loop_function",
  "conditional_function",
  "randomize_order",
  "sample",
  "on_timeline_start",
  "on_timeline_finish",
];

export function isTrialDescription(
  description: TrialDescription | TimelineDescription
): description is TrialDescription {
  return !isTimelineDescription(description);
}

export function isTimelineDescription(
  description: TrialDescription | TimelineDescription | TimelineArray
): description is TimelineDescription | TimelineArray {
  return Boolean((description as TimelineDescription).timeline) || Array.isArray(description);
}

export enum TimelineNodeStatus {
  PENDING,
  RUNNING,
  PAUSED,
  COMPLETED,
  ABORTED,
}

/**
 * Functions and options needed by `TimelineNode`s, provided by the `JsPsych` instance. This
 * approach allows to keep the public `JsPsych` API slim and decouples the `JsPsych` and timeline
 * node classes, simplifying unit testing.
 */
export interface TimelineNodeDependencies {
  /**
   * Called at the start of a trial, prior to invoking the plugin's trial method.
   */
  onTrialStart: (trial: Trial) => void;

  /**
   * Called during a trial, after the plugin has made initial changes to the DOM.
   */
  onTrialLoaded: (trial: Trial) => void;

  /**
   * Called after a trial has finished.
   */
  onTrialFinished: (trial: Trial) => void;

  /**
   * Given a plugin class, creates a new instance of it and returns it.
   */
  instantiatePlugin: <Info extends PluginInfo>(
    pluginClass: Class<JsPsychPlugin<Info>>
  ) => JsPsychPlugin<Info>;

  /**
   * The default inter-trial interval as provided to `initJsPsych`
   */
  defaultIti: number;

  /**
   * JsPsych's display element which is provided to plugins
   */
  displayElement: HTMLElement;

  /**
   * A `PromiseWrapper` whose promise is resolved with result data whenever `jsPsych.finishTrial()`
   * is called.
   */
  finishTrialPromise: PromiseWrapper<TrialResult | void>;
}

export type GetParameterValueOptions = {
  /**
   * The object that holds the parameters of the timeline node. Defaults to `this.description`.
   */
  parameterObject?: Record<string, any>;

  /**
   * If true, and the retrieved parameter value is a function, invoke the function and return its
   * return value (defaults to `true`)
   */
  evaluateFunctions?: boolean;

  /**
   * Whether to fall back to parent timeline node parameters (defaults to `true`)
   */
  recursive?: boolean;
};

export interface TimelineNode {
  readonly description: TimelineDescription | TrialDescription;
  readonly index: number;

  run(): Promise<void>;
  getStatus(): TimelineNodeStatus;

  /**
   * Recursively evaluates the given timeline variable, starting at the current timeline node.
   * Returns the result, or `undefined` if the variable is neither specified in the timeline
   * description of this node, nor in the description of any parent node.
   */
  evaluateTimelineVariable(variable: TimelineVariable): any;

  /**
   * Retrieves a parameter value from the description of this timeline node (or the
   * `parameterObject` provided via `options`), recursively falling back to the description of each
   * parent timeline node unless `recursive` is set to `false`. If the parameter...
   *
   * * is a timeline variable, evaluates the variable and returns the result.
   * * is not specified, returns `undefined`.
   * * is a function and `evaluateFunctions` is not set to `false`, invokes the function and returns
   *   its return value
   *
   * @param parameterPath The path of the respective parameter in the `parameterObject`. If the path
   * is an array, nested object properties or array items will be looked up.
   * @param options See {@link GetParameterValueOptions}
   */
  getParameterValue(parameterPath: string | string[], options?: GetParameterValueOptions): any;
}

export type TrialResult = Record<string, any>;
export type TrialResults = Array<Record<string, any>>;
