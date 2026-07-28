#-------------------------------------------------------------------------------
# Compatibility event bus for the vendored AutomationPy package.
#-------------------------------------------------------------------------------
from threading import Lock


class Event:
    def __init__(self):
        self._observerDictionary = {}

    def __iadd__(self, args):
        if args is not None and len(args) > 1:
            key = args[0]
            value = args[1]
            observers = []
            if key in self._observerDictionary:
                observers = self._observerDictionary[key]
            observers.append(value)
            self._observerDictionary[key] = observers
        return self

    def __isub__(self, args):
        if args is not None and len(args) > 0:
            key = args[0]
            if key in self._observerDictionary:
                self._observerDictionary.pop(key, None)
        return self

    def __call__(self, *args, **kvargs):
        if args is not None and len(args) > 0:
            key = args[0]
            if key in self._observerDictionary:
                observers = self._observerDictionary[key]
                for observer in observers:
                    param = args[1] if len(args) > 1 else None
                    observer(param)


class EventHandler(object):
    _instanceEventHandler = None

    def __new__(cls, *args, **kwargs):
        if not cls._instanceEventHandler:
            cls._instanceEventHandler = super(EventHandler, cls).__new__(
                cls, *args, **kwargs
            )
            cls._invokeSerialMutex = Lock()
            cls._event = Event()
        return cls._instanceEventHandler

    @classmethod
    def addEvent(cls, *args):
        cls._event += args

    @classmethod
    def removeEvent(cls, *args):
        cls._event -= args

    @classmethod
    def callback(cls, *args, **kvargs):
        cls._event(*args, **kvargs)

