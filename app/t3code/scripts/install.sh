#!/bin/sh
# The inherited T3 release installer is not a Weavra distribution channel.
printf '%s\n' 'Weavra installation is unavailable: no Weavra release channel is configured.' >&2
printf '%s\n' 'Build from source: https://github.com/kjg8619/Weavra' >&2
exit 1
