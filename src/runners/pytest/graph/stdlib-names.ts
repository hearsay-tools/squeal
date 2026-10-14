/**
 * `sys.stdlib_module_names` of each Python minor Squeal measured, read with
 * `python -I -S` from uv-managed CPython 3.10.20 and 3.13.14
 * (spec 007 D4 as amended from 007-04). They stand in for the standard
 * library's directories on the search path, so a worktree directory named
 * like a stdlib module (`tests/typing/`) never captures its import, with or
 * without an environment. Regenerate when a supported minor is added.
 */
const MEASURED: Readonly<Record<string, string>> = {
  "3.10":
    "__future__ _abc _aix_support _ast _asyncio _bisect _blake2 _bootsubprocess _bz2 _codecs " +
    "_codecs_cn _codecs_hk _codecs_iso2022 _codecs_jp _codecs_kr _codecs_tw _collections " +
    "_collections_abc _compat_pickle _compression _contextvars _crypt _csv _ctypes _curses " +
    "_curses_panel _datetime _dbm _decimal _elementtree _frozen_importlib " +
    "_frozen_importlib_external _functools _gdbm _hashlib _heapq _imp _io _json _locale " +
    "_lsprof _lzma _markupbase _md5 _msi _multibytecodec _multiprocessing _opcode _operator " +
    "_osx_support _overlapped _pickle _posixshmem _posixsubprocess _py_abc _pydecimal _pyio " +
    "_queue _random _scproxy _sha1 _sha256 _sha3 _sha512 _signal _sitebuiltins _socket " +
    "_sqlite3 _sre _ssl _stat _statistics _string _strptime _struct _symtable _thread " +
    "_threading_local _tkinter _tracemalloc _uuid _warnings _weakref _weakrefset _winapi " +
    "_zoneinfo abc aifc antigravity argparse array ast asynchat asyncio asyncore atexit " +
    "audioop base64 bdb binascii binhex bisect builtins bz2 cProfile calendar cgi cgitb chunk " +
    "cmath cmd code codecs codeop collections colorsys compileall concurrent configparser " +
    "contextlib contextvars copy copyreg crypt csv ctypes curses dataclasses datetime dbm " +
    "decimal difflib dis distutils doctest email encodings ensurepip enum errno faulthandler " +
    "fcntl filecmp fileinput fnmatch fractions ftplib functools gc genericpath getopt getpass " +
    "gettext glob graphlib grp gzip hashlib heapq hmac html http idlelib imaplib imghdr imp " +
    "importlib inspect io ipaddress itertools json keyword lib2to3 linecache locale logging " +
    "lzma mailbox mailcap marshal math mimetypes mmap modulefinder msilib msvcrt " +
    "multiprocessing netrc nis nntplib nt ntpath nturl2path numbers opcode operator optparse " +
    "os ossaudiodev pathlib pdb pickle pickletools pipes pkgutil platform plistlib poplib " +
    "posix posixpath pprint profile pstats pty pwd py_compile pyclbr pydoc pydoc_data pyexpat " +
    "queue quopri random re readline reprlib resource rlcompleter runpy sched secrets select " +
    "selectors shelve shlex shutil signal site smtpd smtplib sndhdr socket socketserver spwd " +
    "sqlite3 sre_compile sre_constants sre_parse ssl stat statistics string stringprep struct " +
    "subprocess sunau symtable sys sysconfig syslog tabnanny tarfile telnetlib tempfile " +
    "termios textwrap this threading time timeit tkinter token tokenize trace traceback " +
    "tracemalloc tty turtle turtledemo types typing unicodedata unittest urllib uu uuid venv " +
    "warnings wave weakref webbrowser winreg winsound wsgiref xdrlib xml xmlrpc zipapp " +
    "zipfile zipimport zlib zoneinfo",
  "3.13":
    "__future__ _abc _aix_support _android_support _apple_support _ast _asyncio _bisect " +
    "_blake2 _bz2 _codecs _codecs_cn _codecs_hk _codecs_iso2022 _codecs_jp _codecs_kr " +
    "_codecs_tw _collections _collections_abc _colorize _compat_pickle _compression " +
    "_contextvars _csv _ctypes _curses _curses_panel _datetime _dbm _decimal _elementtree " +
    "_frozen_importlib _frozen_importlib_external _functools _gdbm _hashlib _heapq _imp " +
    "_interpchannels _interpqueues _interpreters _io _ios_support _json _locale _lsprof _lzma " +
    "_markupbase _md5 _multibytecodec _multiprocessing _opcode _opcode_metadata _operator " +
    "_osx_support _overlapped _pickle _posixshmem _posixsubprocess _py_abc _pydatetime " +
    "_pydecimal _pyio _pylong _pyrepl _queue _random _scproxy _sha1 _sha2 _sha3 _signal " +
    "_sitebuiltins _socket _sqlite3 _sre _ssl _stat _statistics _string _strptime _struct " +
    "_suggestions _symtable _sysconfig _thread _threading_local _tkinter _tokenize " +
    "_tracemalloc _typing _uuid _warnings _weakref _weakrefset _winapi _wmi _zoneinfo abc " +
    "antigravity argparse array ast asyncio atexit base64 bdb binascii bisect builtins bz2 " +
    "cProfile calendar cmath cmd code codecs codeop collections colorsys compileall " +
    "concurrent configparser contextlib contextvars copy copyreg csv ctypes curses " +
    "dataclasses datetime dbm decimal difflib dis doctest email encodings ensurepip enum " +
    "errno faulthandler fcntl filecmp fileinput fnmatch fractions ftplib functools gc " +
    "genericpath getopt getpass gettext glob graphlib grp gzip hashlib heapq hmac html http " +
    "idlelib imaplib importlib inspect io ipaddress itertools json keyword linecache locale " +
    "logging lzma mailbox marshal math mimetypes mmap modulefinder msvcrt multiprocessing " +
    "netrc nt ntpath nturl2path numbers opcode operator optparse os pathlib pdb pickle " +
    "pickletools pkgutil platform plistlib poplib posix posixpath pprint profile pstats pty " +
    "pwd py_compile pyclbr pydoc pydoc_data pyexpat queue quopri random re readline reprlib " +
    "resource rlcompleter runpy sched secrets select selectors shelve shlex shutil signal " +
    "site smtplib socket socketserver sqlite3 sre_compile sre_constants sre_parse ssl stat " +
    "statistics string stringprep struct subprocess symtable sys sysconfig syslog tabnanny " +
    "tarfile tempfile termios textwrap this threading time timeit tkinter token tokenize " +
    "tomllib trace traceback tracemalloc tty turtle turtledemo types typing unicodedata " +
    "unittest urllib uuid venv warnings wave weakref webbrowser winreg winsound wsgiref xml " +
    "xmlrpc zipapp zipfile zipimport zlib zoneinfo",
};

const sets = new Map<string, ReadonlySet<string>>();

/**
 * The stdlib names of `minor` (`3.13`), or of every measured minor at once
 * when it is `null` or unmeasured: a worktree whose Python is unknown treats
 * a name any supported Python ships as the standard library's.
 */
export function stdlibNames(minor: string | null): ReadonlySet<string> {
  const key = minor !== null && minor in MEASURED ? minor : "*";
  let names = sets.get(key);
  if (names === undefined) {
    const lists = key === "*" ? Object.values(MEASURED) : [MEASURED[key] as string];
    names = new Set(lists.flatMap((list) => list.split(" ")));
    sets.set(key, names);
  }
  return names;
}
