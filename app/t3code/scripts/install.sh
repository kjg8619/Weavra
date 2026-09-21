#!/bin/sh
printf '%s\n' 'Weavra server installation is unavailable: no independent hosted release source is configured.' 'Build from the Weavra source checkout using its documented setup. The terminal CLI is weavra; the separate app server executable is weavra-server.' >&2
exit 1
