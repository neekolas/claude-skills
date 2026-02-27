## Architecture

The purpose of this project is to create two shell scripts: add and subtract

### Design

Two shell scripts: one for adding two numbers, one for subtracting.

They should be placed into a new `bin` folder.

#### Constraints

Takes integer or floating point numbers between 0 and 1000. If out of bounds numbers are provided exits with code 1 and writes an exception message to stderr.

## Usage

`add 2 4` -> prints 6 to stdout
`add -2 6` -> prints 4 to stdout
`add 2.3 0.1` -> prints 2.4 to stdout
`subtract 4 2` -> prints 2 to stdout
