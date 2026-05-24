"""Built-in capability class paths."""

BUILTIN_CAPABILITY_CLASSES: dict[str, str] = {
    "chat": "aimtutor.capabilities.chat:ChatCapability",
    "deep_solve": "aimtutor.capabilities.deep_solve:DeepSolveCapability",
    "deep_question": "aimtutor.capabilities.deep_question:DeepQuestionCapability",
    "deep_research": "aimtutor.capabilities.deep_research:DeepResearchCapability",
    "math_animator": "aimtutor.capabilities.math_animator:MathAnimatorCapability",
    "visualize": "aimtutor.capabilities.visualize:VisualizeCapability",
    "auto": "aimtutor.capabilities.auto:AutoCapability",
}
