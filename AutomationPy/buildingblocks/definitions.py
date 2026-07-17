#-------------------------------------------------------------------------------
# Name:
# Purpose:      Compatibility constants for the vendored AutomationPy package.
#
# Author:      liyingho
#
# Created:     06/03/2019
# Copyright:
# Licence:     <your licence>
#-------------- -----------------------------------------------------------------
from enum import Enum

from AutomationPy.buildingblocks.utils import InvalidArgumentException


class LengthType(Enum):
    def __str__(self):
        return self.value

    METER = "m"
    MIL_METER = "mm"
    CENT_METER = "cm"
    KILO_METER = "km"
    YARD = "yd"
    FOOT = "ft"
    INCH = "in"
    MILE = "mi"


class RESULTS(Enum):
    def __str__(self):
        return self.value

    PASSED = "PASSED"
    FAILED = "FAILED"
    SKIPPED = "SKIPPED"
    UNKNOWN = "UNKNOWN"


class LengthMetric:
    def __getitem__(self, index):
        if index is None or not (type(index) is LengthType):
            raise InvalidArgumentException(index)

        return {
            LengthType.MIL_METER: 1000.0,
            LengthType.CENT_METER: 100.0,
            LengthType.KILO_METER: 0.001,
            LengthType.INCH: 39.3701,
            LengthType.FOOT: 3.28084,
            LengthType.YARD: 1.09361,
            LengthType.MILE: 0.000621371,
        }[index]


class Consts:
    STATE_COMPLETE_EVENT = "StateComplete"
    STREAM_DATA = "streamData"
    STATE_OBJ_SUFFIX = "_state"
    ACTION_DATA = "actionData"
    ARGS_DATA = "args"
    COMPLETED_MSG_FORMAT = "{} completed."
    FAILED_MSG = "State failed."
    BACKUP = "Backup"
    SKIP = "skip"
    TIMEOUT = "timeout"
    COMMAND_FORMAT = "commandFormat"
    TRANSCTION_COMPLETE = "transactionComplete"
    BKC_AUTOMATION_PACKAGE = "bkc_automation_state"
    BKC_STATE_OBJ_PREFIX = "bkc_automation_"
    WORK_DIRECTORY = "workDirectory"
    SOURCE_BKC_FILE_NAME_PATTERN = "sourceBkcFileNamePattern"
    REGEX_GUILD_PATTERN = (
        r"(\{){0,1}[0-9a-fA-F]{8}\-[0-9a-fA-F]{4}\-[0-9a-fA-F]{4}\-[0-9a-fA-F]{4}\-"
        r"[0-9a-fA-F]{12}(\}){0,1}"
    )
