# SrcInsight

SrcInsight is the engine behind the Insight feature in Codryn.

When you use Insight to explore your code, Insight asks SrcInsight to read your project and find how functions and types are connected. The results you see in Insight come from this engine.

This folder holds the SrcInsight program file used by Codryn.

## Language Support

SrcInsight currently supports three programming languages: TypeScript, Python, and Golang.

- TypeScript has the best support so far (Although actually there are still some shortcomings..)
- Golang also has good support.
- Python support is still very basic.

One detail for TypeScript: only CONST variables are supported for now. VAR and LET are not supported yet.

Frameworks for building user interfaces such as Vue, React, and others are not supported yet. Vue will be supported first, together with React.

### TypeScript Scope:
class, interface, enum, function, method, type alias, generic, import, export.

### Python Scope:
class, function, method, import.

### Golang Scope:
class, interface, struct, function, method, type alias, generic, import.

## Found a Problem

SrcInsight source code is closed to the public, and no modifications can be made in the code. 

If you’ve encountered a bug, a performance issue, or anything else with SrcInsight, please submit an issue to the Issues section of Codryn repository.

Make sure to prefix your issue title with the tag below. Please make it brief. 

[SrcInsight] Issue description of the problem.

Example of issue title: [SrcInsight] It couldn’t find function in my TypeScript project. 

Please describe what programming language you were using, what you were attempting to do, what you expected to see, and what actually happened.
