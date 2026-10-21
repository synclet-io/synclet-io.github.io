---
title: Transforms
description: Rename, set, cast, hash, mask, filter and drop record fields with a list of steps and CEL expressions.
---

Transforms change records on their way from the source to the destination. You set them per stream in the **Transform** tab of the stream's settings. The tab appears once the connection is saved.

## How Transforms Work

A stream's transform is a list of steps. Synclet runs them in the router, the part of a sync that passes records from the source to the destination:

- The steps run top to bottom, once per record. Each step sees the record as the step before it left it.
- All entries of one step read the record as it was before that step. A **Set** step that creates `a` cannot use `r.a` in another entry of the same step; put that entry in a later step.
- After the last step, [field selection](/docs/guides/stream-configuration/#field-selection) is applied. Fields you did not select are still readable by the steps. Every field a step writes is kept, even if it is not selected.
- The destination receives the schema the steps produce: renamed fields under their new names, new fields with the type their expression returns, cast fields with their new type.

The tab shows three columns: the input columns of the stream, the steps, and the output columns with marks such as **new**, **renamed**, **type changed** and **dropped** (not selected and not written by any step). A field removed by a **Drop** step is not listed at all.

If a rename changes a primary key or cursor field, Synclet uses the new name. In **Append + Dedup** mode, every primary key field must be selected or written by a step.

## Step Kinds

| Step | What it does | On error |
|---|---|---|
| **Rename** | Gives fields new names. | Not available |
| **Set** | Writes a field from a CEL expression. The field can be new or existing. | fail, null, skip |
| **Cast** | Converts a field to another type. | fail, null, skip (per field too) |
| **Hash** | Replaces values with a salted SHA-256 hex string. | fail, null, skip |
| **Mask** | Replaces characters with `*`, keeping some at the start and end. | fail, null, skip |
| **Filter** | Keeps only records for which an expression is true. | fail, skip |
| **Drop** | Removes fields from the record. | Not available |

### Rename

Maps old names to new ones, for example `first_name` → `given_name`. A new name cannot be an existing field, unless that field is renamed in the same step, so you can swap two names in one step. Later steps must use the new name: reading `r.first_name` after the rename is rejected with `field "first_name" was renamed by step 0`.

### Set

Each entry is a field name and an expression, for example `full_name` = `r.first_name + " " + r.last_name`. The field takes the type the expression returns. Setting an existing field replaces its value and its type: `id` = `string(r.id)` turns `42` into `"42"` and the column into a string.

### Cast

Converts a field to `string`, `integer`, `number`, `boolean`, `timestamp`, `date`, `object` or `array`. Options:

| Option | Applies to | Meaning |
|---|---|---|
| **Format** | timestamp, date, string | `iso8601` (default), `unix`, `unix_ms` or a pattern such as `dd.MM.yyyy HH:mm` (see [Timestamp formats](#timestamp-formats)). For timestamp and date it is the format of the input; for string it is the output format of an ISO 8601 input. |
| **Timezone for values without one** | timestamp, date | An IANA name such as `Europe/Kyiv`. Default UTC. |
| **Decimal separator**, **Thousands separator** | integer, number | For text such as `1.234,56`: decimal `,`, thousands `.` gives `1234.56`. |
| **Strip prefix**, **Strip suffix**, **Trim** | integer, number | Remove a currency sign, a unit or spaces before parsing: `"$ 1,200"` with prefix `$`, trim and thousands `,` gives `1200`. |
| **True values**, **False values** | boolean | Text that means true or false, matched case-insensitively. Default: `true 1 yes y t` and `false 0 no n f`. |
| **Source expression** | all | Cast the result of an expression instead of the field. The field can be new. |
| **On error** | all | Overrides the step's on error for this field. |

Results: a timestamp becomes an RFC 3339 string (`2026-01-02T10:00:00+02:00`), a date becomes `yyyy-MM-dd`, `integer` rejects a value with a fractional part, `object` and `array` parse a JSON string, and `string` of an object or array writes its JSON.

### Hash

Lists fields whose values are replaced with a 64-character hex SHA-256 hash. Strings, numbers and booleans are hashed as text (`42` is hashed as `"42"`); an object or array is an error. Null and missing values stay as they are. The result is a string column.

Each connection has a random salt, created with the connection. The hash is SHA-256 of the salt followed by the value, so:

- the same value gives the same hash in every sync of a connection, so you can still join and count by the hashed column;
- the same value gives a different hash in another connection, and a hash cannot be looked up in a precomputed table of SHA-256 hashes of known emails or phone numbers.

The Test panel hashes without the salt, so the hashes it shows differ from the ones a sync writes. If you need an unsalted hash that matches other systems, use `sha256()` in a Set step; it never uses the salt.

### Mask

For each field, **first** and **last** set how many characters to keep. With first 2 and last 4, `Ada@Example.COM` becomes `Ad*********.COM`. With both empty every character is masked: `Ada` becomes `***`. If first + last covers the whole value, it stays unchanged. Numbers are masked as text, and the result is a string column. Null and missing values stay as they are.

### Filter

One expression that must return a boolean, for example `r.status != "test"`. Records for which it is false are dropped and do not reach the destination.

:::caution
In **Append + Dedup** mode (and for CDC streams) Synclet warns that "rows filtered out later stay in the destination": if a record passed the filter in an earlier sync and is filtered out now, the row written earlier is not deleted.
:::

### Drop

Lists fields to remove from the record. A dropped field is not written to the destination and is not in its schema, even when it is selected on the **Fields** tab. Later steps cannot read it: `r.amount` after a drop of `amount` is rejected with `field "amount" was dropped by step 0`. A later Set step can write the name again as a new field.

Drop is how you compute a value from a field without writing that field. Some sources send only the selected fields, so a field you want to read must stay selected. Select it, use it, then drop it:

1. **Set** `total_cents` = `int(r.amount * 100.0)`
2. **Drop** `amount`

The destination gets `total_cents` and no `amount`.

A primary key field cannot be dropped in **Append + Dedup** mode. In other modes, dropping it removes it from the primary key the destination receives.

An **Incremental** stream cannot drop its cursor field, under its original name or a name a rename gave it; choose another cursor in the stream settings or keep the field. A **Full Refresh** stream can drop it.

:::note
When fields are selected, a step whose expression reads a field that is not selected gets a warning: `field "amount" is not selected; sources that honour field selection will not send it — select it and drop it after use`. Many sources send every field anyway, so this is a warning, not an error. Fields written by an earlier step do not get it.
:::

### On Error

A step fails for one record when an expression or a conversion fails on its values, for example a cast of `"n/a"` to number or `r.id / 0`. What happens then depends on the step's **On error**:

| Value | Effect |
|---|---|
| **Fail the sync** (default) | The sync fails with an error that names the stream, the step and the field, such as `stream "users": mapper step 0, field "amount": cannot cast "n/a" to number`. Steps are counted from 0 in these messages. |
| **Write null** | The field that failed gets `null`; the record goes on. The output column becomes nullable. Not available on Filter. |
| **Skip the record** | The record is dropped and the sync goes on. |

Rename and Drop have no on error: they cannot fail on a record. On Cast, each field can set its own on error; **As the step** uses the step's value.

## Expressions

Set, Filter and Cast's source expression use [CEL](https://cel.dev), a small expression language. An expression computes one value from the record; it cannot change anything else.

The examples below use this record:

```json
{
  "id": 42,
  "version_id": 3,
  "first_name": "Ada",
  "last_name": "Lovelace",
  "email": "Ada@Example.COM",
  "status": "active",
  "amount": "1.234,56",
  "tstamp": "2026-03-15T09:30:00Z",
  "local_time": "02.01.2026 10:00",
  "nickname": null,
  "address": { "city": "Kyiv", "zip": null },
  "tags": ["vip", "beta"],
  "items": [{ "sku": "A1", "qty": 2 }, { "sku": "B2", "qty": 0 }]
}
```

In the stream's schema `id` is an integer, `version_id` is a number, `tstamp` is a string with format `date-time`, and `last_name`, `nickname` and `address.zip` can be null.

### Reading Fields

The record is the variable `r`. Use a dot for fields and nested fields, and `[n]` for list items, counted from 0:

| Expression | Result |
|---|---|
| `r.first_name` | `"Ada"` |
| `r.address.city` | `"Kyiv"` |
| `r.tags[0]` | `"vip"` |
| `r.items[0].sku` | `"A1"` |

A field that is not in the schema is rejected when you edit the step: `undefined field 'nosuch'`. Field names must be valid identifiers (letters, digits and `_`, not starting with a digit) to be read; `r["first-name"]` does not work. Rename such a field first.

### Sync Metadata

`sync` describes the current sync:

| Expression | Type | Value |
|---|---|---|
| `sync.started_at` | timestamp | When the sync started, in UTC. |
| `sync.job_id` | string | The ID of the sync job. |
| `sync.connection` | string | The connection's ID. |

All records of one sync see the same values. In the Test panel, `sync.started_at` is the current time, `sync.job_id` is `"preview"` and `sync.connection` is the connection's name.

### Literals

| Literal | Type |
|---|---|
| `42`, `-7` | int |
| `42u` | uint |
| `4.2`, `1e3` | double |
| `"text"`, `'text'` | string |
| `true`, `false` | bool |
| `null` | null |
| `[1, 2]` | list |
| `{"a": 1}` | map |

### Operators

| Operator | Example | Result |
|---|---|---|
| `+ - * /` | `r.id * 2` | `84` |
| `/` on ints divides without remainder | `r.id / 5` | `8` |
| `%` remainder | `r.id % 5` | `2` |
| on doubles | `r.version_id / 2.0` | `1.5` |
| `== != < <= > >=` | `r.id > 40` | `true` |
| `&&`, `\|\|`, `!` | `r.id > 40 && r.status == "active"` | `true` |
| `in` a list | `r.status in ["active", "trial"]` | `true` |
| `in` a field's list | `"vip" in r.tags` | `true` |
| `? :` | `r.status == "active" ? 1 : 0` | `1` |

`+` also joins strings (`"a" + "b"`) and lists (`r.tags + ["new"]` gives `["vip","beta","new"]`). Both branches of `? :` must have the same type: `r.status == "active" ? 1 : "no"` is rejected.

### Types

Every value has a type, and CEL never converts between types on its own. Types come from the stream's schema:

| Schema type | CEL type |
|---|---|
| `integer` | int |
| `number` | double |
| `string`, including date and date-time strings | string |
| `boolean` | bool |
| `array` | list |
| `object` with properties | object with fields |
| `object` without properties, or a field with several types | any |

Mixing types in an operator is rejected before you can save:

- `r.id * 1.5` → `found no matching overload for '_*_' applied to '(int, double)'`. Write `double(r.id) * 1.5` (`63`).
- `r.version_id + "-x"` → `found no matching overload for '_+_' applied to '(double, string)'`. Numbers are not joined to strings automatically; convert first: `string(r.version_id) + "-x"` gives `"3-x"`, and `string(r.id) + "-" + r.status` gives `"42-active"`.

A number field is a double even when its values look whole: `version_id` is `3` in the JSON, `r.version_id / 2.0` works, and `r.version_id / 2` is rejected with `'(double, int)'`.

### Conversions

| Expression | Result |
|---|---|
| `int("42")` | `42` |
| `int(4.9)` | `4` (cuts the fraction) |
| `int(" 42")`, `int("4.2")` | Fails when the record is processed |
| `uint(42)` | `42` |
| `double("4.2")` | `4.2` |
| `double(r.id)` | `42` |
| `string(2.5)` | `"2.5"` |
| `string(r.version_id)` | `"3"` |
| `string(true)` | `"true"` |
| `bool("true")` | `true` (also accepts `"1"`, `"t"`, `"TRUE"`; `"yes"` fails) |
| `int(parseTimestamp(r.tstamp, "iso8601"))` | `1773567000` (Unix seconds) |

`int()`, `uint()` and `double()` read a string as a number. A field whose schema says it holds a date, time or date-time is rejected, because no value of it would convert: `int(r.tstamp)` gives `"tstamp" is a date-time string, int() cannot read it; use int(parseTimestamp(r.tstamp, "iso8601")) for epoch seconds`.

For numbers written with a comma or thousands separators, use [`parseNumber`](#parsenumber) or a Cast step.

### Missing Fields and Null

`has(r.field)` is true when the record contains the field, even when its value is `null`:

| Record | `has(r.nickname)` |
|---|---|
| `"nickname": null` | `true` |
| no `nickname` key | `false` |

Reading a missing field fails (`no such key: nickname`). Comparing a field with `null` is rejected: `r.nickname == null` gives `found no matching overload for '_==_' applied to '(string, null)'`. Use `coalesce` instead.

`coalesce(a, b, ...)` returns the first argument that is present and not null:

| Expression | Result |
|---|---|
| `coalesce(r.nickname, r.first_name)` | `"Ada"` |
| `coalesce(r.address.zip, "unknown")` | `"unknown"` |
| `coalesce(r.nickname, r.last_name, "anon")` | `"Lovelace"` |
| `coalesce(r.nickname, "") == ""` | `true`: a null check |

A missing field falls through like a null one. `coalesce` needs at least two arguments, all of one type (`coalesce(r.id, "x")` is rejected with `coalesce arguments have different types: int and string`), and none of them can be the literal `null`.

An expression that uses a nullable field without `coalesce` fails on a record where the field is null. With `"last_name": null`, `r.first_name + " " + r.last_name` fails with `no such overload`. Such a Set field's output column is marked nullable.

## Built-in Functions

### Strings

| Function | Example | Result |
|---|---|---|
| `lowerAscii()` | `r.email.lowerAscii()` | `"ada@example.com"` |
| `upperAscii()` | `r.email.upperAscii()` | `"ADA@EXAMPLE.COM"` |
| `trim()` | `"  Ada  ".trim()` | `"Ada"` |
| `substring(start[, end])` | `r.first_name.substring(0, 2)` | `"Ad"` |
| `split(sep[, limit])` | `r.email.split("@")` | `["Ada","Example.COM"]` |
| `replace(old, new[, limit])` | `r.amount.replace(".", "")` | `"1234,56"` |
| `charAt(i)` | `r.first_name.charAt(0)` | `"A"` |
| `indexOf(s[, from])` | `r.email.indexOf("@")` | `3` |
| `lastIndexOf(s[, from])` | `r.email.lastIndexOf(".")` | `11` |
| `join([sep])` on a list | `r.tags.join(", ")` | `"vip, beta"` |
| `format(list)` | `"%s-%d".format([r.status, r.id])` | `"active-42"` |
| `reverse()` | `r.first_name.reverse()` | `"adA"` |
| `strings.quote(s)` | `strings.quote(r.first_name)` | `"\"Ada\""` |
| `size()` | `size(r.first_name)` | `3` |
| `contains(s)` | `r.email.contains("@")` | `true` |
| `startsWith(s)` | `r.email.startsWith("Ada")` | `true` |
| `endsWith(s)` | `r.email.endsWith(".COM")` | `true` |
| `matches(regex)` | `r.email.matches("^[^@]+@[^@]+$")` | `true` |

`lowerAscii` and `upperAscii` change only ASCII letters. `matches` uses [RE2](https://github.com/google/re2/wiki/Syntax) syntax. `format` supports `%s`, `%d`, `%f` with precision (`"%.2f".format([r.version_id])` gives `"3.00"`), `%e`, `%x`, `%o` and `%b`, but no width or zero padding: `"%02d"` is rejected.

### Lists

| Expression | Result |
|---|---|
| `size(r.tags)` | `2` |
| `r.tags.exists(t, t == "vip")` | `true` |
| `r.items.all(i, i.qty > 0)` | `false` |
| `r.items.exists_one(i, i.qty > 0)` | `true` |
| `r.items.map(i, i.sku)` | `["A1","B2"]` |
| `r.items.filter(i, i.qty > 0)` | `[{"qty":2,"sku":"A1"}]` |
| `r.items.map(i, i.qty > 0, i.sku)` | `["A1"]` (filter and map) |

The first argument names the item; the second is an expression over it.

### Timestamps and Durations

| Expression | Result |
|---|---|
| `timestamp("2026-01-01T00:00:00Z")` | timestamp; the text must be RFC 3339 |
| `duration("1h30m")` | duration; units `h`, `m`, `s`, `ms`, `us`, `ns` (no `d`: write `"720h"` for 30 days) |
| `t + duration("24h")` | timestamp a day later |
| `sync.started_at - t` | duration between them |
| `t < sync.started_at` | `true` |
| `int(t)` | Unix seconds: `1773567000` |
| `string(t)` | `"2026-03-15T09:30:00Z"` |

To get a timestamp from a field, use [`parseTimestamp`](#parsetimestamp). Getters on `t = parseTimestamp(r.tstamp, "iso8601")`:

| Getter | Result | Note |
|---|---|---|
| `t.getFullYear()` | `2026` | |
| `t.getMonth()` | `2` | January is 0 |
| `t.getDate()` | `15` | Day of month from 1 |
| `t.getDayOfMonth()` | `14` | Day of month from 0 |
| `t.getDayOfWeek()` | `0` | Sunday is 0 |
| `t.getDayOfYear()` | `73` | January 1 is 0 |
| `t.getHours()` | `9` | |
| `t.getHours("Europe/Kyiv")` | `11` | Every getter takes an optional timezone; default UTC |
| `t.getMinutes()`, `t.getSeconds()`, `t.getMilliseconds()` | `30`, `0`, `0` | |

On a duration, `getHours()`, `getMinutes()`, `getSeconds()` and `getMilliseconds()` return the whole duration in that unit: `duration("1h30m").getMinutes()` is `90`.

A Set field that returns a timestamp is written as an RFC 3339 string with a `date-time` schema; a duration is written as text such as `"5258h30m0s"`.

## Synclet Functions

### coalesce

`coalesce(a, b, ...)` returns the first argument that is present and not null. See [Missing Fields and Null](#missing-fields-and-null).

### catch

`catch(value, fallback)` returns `value`, or `fallback` when evaluating `value` fails: a conversion of a bad string, a missing field, division by zero.

| Expression | Record | Result |
|---|---|---|
| `catch(int(r.qty), 0)` | `"qty": " asd"` | `0` |
| `catch(int(r.qty), 0)` | `"qty": "42"` | `42` |
| `catch(r.discount * 2, -1)` | no `discount` key | `-1` |
| `catch(r.total / r.count, 0)` | `"count": 0` | `0` |
| `catch(int(" asd"), 0) + 10` | any | `10` |

Both arguments must have the same type: `catch(int(r.qty), "n/a")` is rejected. A null value is not an error, so `catch` returns it; use `coalesce` for nulls. An error in the fallback is not caught and fails the step.

`catch` hides every error inside its first argument, including ones you did not expect. Wrap only the part that can fail: `catch(int(r.qty), 0) * r.price` rather than `catch(int(r.qty) * r.price, 0)`.

The checks Synclet runs while you edit still apply inside `catch`: `catch(int(r.created_at), 0)` on a date-time field and `catch(parseTimestamp(r.day, "QQ"), now())` are rejected, because the inner call would fail on every record.

### parseTimestamp

`parseTimestamp(value, format)` and `parseTimestamp(value, format, timezone)` read a string as a timestamp. The value must be a string: for an integer field write `parseTimestamp(string(r.created), "unix")`.

The timezone is an IANA name such as `Europe/Kyiv`, used for values that carry no offset. Default UTC. Values with an offset or `Z` keep it.

| Expression | Result |
|---|---|
| `parseTimestamp(r.tstamp, "iso8601")` | `2026-03-15T09:30:00Z` |
| `parseTimestamp("2026-03-15 09:30:00", "iso8601")` | `2026-03-15T09:30:00Z` |
| `parseTimestamp("2026-03-15", "iso8601")` | `2026-03-15T00:00:00Z` |
| `parseTimestamp("2026-03-15T09:30:00", "iso8601", "Europe/Kyiv")` | `2026-03-15T09:30:00+02:00` |
| `parseTimestamp("2026-03-15T09:30:00Z", "iso8601", "Europe/Kyiv")` | `2026-03-15T09:30:00Z` |
| `parseTimestamp("1767225600", "unix")` | `2026-01-01T00:00:00Z` |
| `parseTimestamp("1767225600.5", "unix")` | `2026-01-01T00:00:00.5Z` |
| `parseTimestamp("1767225600123", "unix_ms")` | `2026-01-01T00:00:00.123Z` |
| `parseTimestamp(r.local_time, "dd.MM.yyyy HH:mm")` | `2026-01-02T10:00:00Z` |
| `parseTimestamp(r.local_time, "dd.MM.yyyy HH:mm", "Europe/Kyiv")` | `2026-01-02T10:00:00+02:00` |
| `parseTimestamp("03/15/2026", "MM/dd/yyyy")` | `2026-03-15T00:00:00Z` |
| `parseTimestamp("15.03.26 09:30 PM", "dd.MM.yy hh:mm a")` | `2026-03-15T21:30:00Z` |

#### Timestamp Formats

The same formats are used by `parseTimestamp` and the Cast step's **Format**:

- `iso8601`: `2026-03-15T09:30:00Z`, with or without an offset, fractional seconds, a space instead of `T`, or a date alone.
- `unix`: seconds since 1970-01-01 UTC, fractions allowed.
- `unix_ms`: milliseconds since 1970-01-01 UTC.
- A pattern built from these tokens:

| Token | Meaning | Example |
|---|---|---|
| `yyyy` | Year | `2026` |
| `yy` | Two-digit year | `26` |
| `MM` | Month | `03` |
| `dd` | Day | `15` |
| `HH` | Hour, 00–23 | `21` |
| `hh` | Hour, 01–12 | `09` |
| `a` | AM or PM | `PM` |
| `mm` | Minutes | `30` |
| `ss` | Seconds | `00` |
| `SSS` | Milliseconds | `123` |
| `XXX` | Offset | `+02:00` or `Z` |

Punctuation and spaces are copied as is. Put a literal `T` in single quotes: `yyyy-MM-dd'T'HH:mm:ssXXX`. Other letters are rejected, so `DD.MM.YYYY` fails with `unknown cast format "DD.MM.YYYY"`. A pattern must match the whole value: `dd.MM.yyyy` on `02.01.2026 10:00` fails with `extra text: " 10:00"`.

### parseNumber

`parseNumber(value, decimalSeparator)` reads a string as a double. The other of `.` and `,` and spaces are taken as thousands separators.

| Expression | Result |
|---|---|
| `parseNumber(r.amount, ",")` | `1234.56` |
| `parseNumber("1,234.56", ".")` | `1234.56` |
| `parseNumber("1 234,56", ",")` | `1234.56` |
| `int(parseNumber("1.234", ","))` | `1234` |
| `parseNumber("n/a", ",")` | Fails: `"n/a" is not a number` |

### sha256

`sha256(value)` returns the hex SHA-256 of a string, without the connection's salt. `sha256(r.email.lowerAscii())` gives `b5fc85e55755f9e0d030a10ab4429b6b2944855f9a0d60077fe832becbc41d72`. For a number, convert it first: `sha256(string(r.id))`.

### now

`now()` returns the current time in UTC when the record is processed, so it differs from record to record. Use `sync.started_at` for one value per sync.

## Checking Your Steps

Synclet checks the steps while you edit them and again when you save. A stream whose steps have errors cannot be saved. The check catches:

- a field that does not exist, or one renamed or dropped by an earlier step;
- a new field name that is empty, has leading or trailing spaces, or already exists;
- syntax errors, unknown functions and type mismatches, such as `r.id * 1.5` or `r.version_id + "-x"`;
- `int()`, `uint()` or `double()` of a date, time or date-time field;
- a filter that does not return a boolean;
- an unknown cast target, a `parseTimestamp` or Cast format that is not one of the [formats](#timestamp-formats), or an unknown timezone, when written as text in the step;
- `coalesce` with one argument, mixed types or a `null` argument;
- on error values a step does not allow;
- primary key fields that are neither selected nor written, or that a Drop step removes, in Append + Dedup mode.

These depend on the values and fail only when a record is processed:

- a conversion of a value that is not a number, such as `int(r.status)` or a Cast of `"n/a"` to number;
- a null in a field the expression uses outside `coalesce`;
- a field missing from the record;
- `parseTimestamp` or `parseNumber` on a value that does not match;
- division by zero and integer overflow;
- a list index past the end, such as `r.tags[5]`;
- hashing or masking an object or a list.

A failure is handled by the step's [on error](#on-error), or by [`catch`](#catch) around the part that failed.

When a new schema discovery makes a connection's steps invalid, for example because a field they read was removed, Synclet pauses the connection with a reason naming the stream and the step.

### The Test Panel

Paste a sample record as JSON into **Test**, or click **Generate from schema** to fill one from the stream's columns. The panel runs the record through the steps and shows the record after each step, the error of a step that failed, or **Filtered out**. It runs only when the steps have no errors. Hashes in the panel are computed without the connection's salt.

## Recipes

### Epoch Seconds From a Date-Time String

Set `tstamp_epoch` = `int(parseTimestamp(r.tstamp, "iso8601"))` → `1773567000`.

For milliseconds: `int(parseTimestamp(r.tstamp, "iso8601")) * 1000 + parseTimestamp(r.tstamp, "iso8601").getMilliseconds()` → `1773567000000`.

For a local time without an offset: `int(parseTimestamp(r.local_time, "dd.MM.yyyy HH:mm", "Europe/Kyiv"))` → `1767340800`.

### Joining Values

- `string(r.id) + "-" + string(r.version_id)` → `"42-3"`
- `"%d-%s".format([r.id, r.status])` → `"42-active"`
- `coalesce(r.last_name, "") == "" ? r.first_name : r.first_name + " " + r.last_name` → `"Ada Lovelace"`, or `"Ada"` when `last_name` is null
- `r.tags.join(",")` → `"vip,beta"`

### Hashing a Field

- With the salt: add a **Hash** step with `email`. Two syncs of the connection write the same hash for the same email; another connection writes a different one.
- Normalize first so `Ada@Example.COM` and `ada@example.com` hash the same: a Set step `email` = `r.email.lowerAscii()`, then the Hash step.
- Without the salt, for example to match hashes made by another system: Set `email` = `sha256(r.email.lowerAscii())` → `b5fc85e55755f9e0d030a10ab4429b6b2944855f9a0d60077fe832becbc41d72`.

### Defaulting Nulls

One Set step with:

- `nickname` = `coalesce(r.nickname, r.first_name)` → `"Ada"`
- `zip` = `coalesce(r.address.zip, "unknown")` → `"unknown"`

The new columns are not nullable, because `coalesce` ends with a value that cannot be null.

To write a default instead of failing the sync when a value cannot be computed, wrap the part that can fail in [`catch`](#catch): `qty` = `catch(int(r.qty), 0)`. To write `null` instead, set the step's on error to **Write null**.

### Filtering Rows

- `r.status != "test"` drops test records.
- `!("test" in r.tags) && r.items.exists(i, i.qty > 0)` keeps records without the `test` tag that have at least one item in stock.
- `sync.started_at - parseTimestamp(r.tstamp, "iso8601") < duration("720h")` keeps records from the last 30 days.
- `coalesce(r.last_name, "").startsWith("L")` handles a nullable field; without `coalesce` a null `last_name` fails the step.

### Reformatting a Date

- ISO 8601 to `dd.MM.yyyy`: Cast `tstamp` to **string** with format `dd.MM.yyyy` → `"15.03.2026"`.
- ISO 8601 to Unix seconds as text: Cast `tstamp` to **string** with format `unix` → `"1773567000"`.
- `dd.MM.yyyy HH:mm` to a timestamp: Cast `local_time` to **timestamp** with format `dd.MM.yyyy HH:mm` and timezone `Europe/Kyiv` → `"2026-01-02T10:00:00+02:00"`.
- `dd.MM.yyyy HH:mm` to a date: Cast `local_time` to **date** with format `dd.MM.yyyy HH:mm` → `"2026-01-02"`.
- Into a new field: Cast `day` to **string** with format `yyyy-MM-dd` and source expression `parseTimestamp(r.local_time, "dd.MM.yyyy HH:mm")` → `"2026-01-02"`.
- The date part of an ISO 8601 string: Set `day` = `r.tstamp.substring(0, 10)` → `"2026-03-15"`.

### Parsing "1.234,56"

- In place: Cast `amount` to **number** with decimal separator `,` and thousands separator `.` → `1234.56`.
- Into a new field: Set `amount_value` = `parseNumber(r.amount, ",")` → `1234.56`.

## Next Steps

- [Stream Configuration](/docs/guides/stream-configuration/) — Field selection, sync modes and primary keys.
- [Sync Modes](/docs/concepts/sync-modes/) — How Append + Dedup writes records by primary key.
