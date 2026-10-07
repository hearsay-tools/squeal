#!/bin/bash
# Throwaway: print a block bracketed by a begin and an end marker, as a pull might.
echo "squeal-pull begin $1"
for i in 1 2 3 4 5; do echo "line $i of $1"; done
echo "squeal-pull end $1"
