// Pure: combine the model's assessment and the pull request's labels into
// one grade. The model decides the risk and the door; the label can only
// add a one-way door.

import { ONE_WAY_DOOR_LABEL } from "./config.js";
import { maxLevel, type Door, type Level, type Signals } from "./signals.js";

export interface Finding {
  severity: Level;
  text: string;
}

// What the model returns. The schema in assess.ts must satisfy this.
export interface Assessment {
  customer: Level;
  data_security: Level;
  recovery: Level;
  door: Door;
  door_reason: string;
  confidence: number;
  summary: string;
  findings: Finding[];
}

export interface Grade {
  door: Door;
  doorReasons: string[];
  risk: Level;
  confidence: number;
  // Null when the diff was not assessed; `ungraded` then says why.
  assessment: Assessment | null;
  ungraded: string | null;
}

export function buildGrade(
  signals: Signals,
  assessment: Assessment | null,
  labels: string[],
): Grade {
  const doorReasons: string[] = [];
  if (labels.includes(ONE_WAY_DOOR_LABEL)) {
    doorReasons.push(`label: ${ONE_WAY_DOOR_LABEL}`);
  }
  if (assessment?.door === "one-way") {
    doorReasons.push(`assessment: ${assessment.door_reason}`);
  }
  const door: Door = doorReasons.length > 0 ? "one-way" : "two-way";

  if (assessment === null) {
    return {
      door,
      doorReasons,
      // Ungraded is the highest risk: fail closed.
      risk: "high",
      confidence: 0,
      assessment: null,
      ungraded: signals.ungradeable ?? "the model returned no assessment",
    };
  }

  return {
    door,
    doorReasons,
    risk: maxLevel(
      assessment.customer,
      assessment.data_security,
      assessment.recovery,
      ...assessment.findings.map((finding) => finding.severity),
    ),
    confidence: validConfidence(assessment.confidence),
    assessment,
    ungraded: null,
  };
}

// Anything that is not a number from 0 to 100 counts as no confidence.
function validConfidence(value: number): number {
  return Number.isFinite(value) && value >= 0 && value <= 100 ? value : 0;
}
