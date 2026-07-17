from automation.workstates.orbitAutomation_state import OrbitAutomationState
from AutomationPy.buildingblocks.workflow.workstate import WorkState


def test_vendored_automation_package_is_directly_importable() -> None:
    assert issubclass(OrbitAutomationState, WorkState)

