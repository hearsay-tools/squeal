"""pluggy 1.7.0: what the host learns when a plugin does not match the hook specs."""
import pluggy

spec = pluggy.HookspecMarker("host")
impl = pluggy.HookimplMarker("host")


class Specs:
    @spec
    def check(self, path, revision):
        """Return a verdict for path."""

    @spec(firstresult=True)
    def select(self, changed):
        """Return the first plugin's selection."""


def manager():
    pm = pluggy.PluginManager("host")
    pm.add_hookspecs(Specs)
    return pm


def case(title, fn):
    try:
        print(f"{title}: {fn()}")
    except Exception as e:  # noqa: BLE001
        print(f"{title}: {type(e).__name__}: {str(e).splitlines()[0]} | plugin_name in message: {'old_plugin' in str(e) or 'typo_plugin' in str(e) or 'bad' in str(e)}")


class OldPlugin:  # takes a subset of the spec's arguments
    @impl
    def check(self, path):
        return f"ok {path}"


class NewArgPlugin:  # asks for an argument the host does not have
    @impl
    def check(self, path, coverage):
        return "never"


class TypoPlugin:  # implements a hook the host never declared
    @impl
    def chek(self, path):
        return "never"


class Raises:
    @impl
    def check(self, path):
        raise RuntimeError("plugin bug")


class First:
    @impl
    def select(self, changed):
        return None


class Second:
    @impl
    def select(self, changed):
        return ["b.py"]


def subset():
    pm = manager(); pm.register(OldPlugin(), name="old_plugin")
    return pm.hook.check(path="a.py", revision=7)


def unknown_arg():
    pm = manager(); pm.register(NewArgPlugin(), name="bad")
    return "registered"


def unknown_hook():
    pm = manager(); pm.register(TypoPlugin(), name="typo_plugin")
    pm.check_pending()
    return "pending ok"


def raises():
    pm = manager(); pm.register(OldPlugin(), name="old_plugin"); pm.register(Raises(), name="bad")
    return pm.hook.check(path="a.py", revision=7)


def first():
    pm = manager(); pm.register(Second(), name="second"); pm.register(First(), name="first")
    return pm.hook.select(changed=["a.py"])


print("pluggy", pluggy.__version__)
case("impl takes a subset of spec args", subset)
case("impl names an arg not in the spec", unknown_arg)
case("impl of an undeclared hook, then check_pending", unknown_hook)
case("one impl raises among two", raises)
case("firstresult skips None", first)
