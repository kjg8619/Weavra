# Todo 19 fix1 image inspection

Current head 14914ad09237ab6d89e6c21b11b0e2e008fa42d5; stack reference
fb97140d; unchanged shared runner fa5e1dbc.

The head package/capture, 158 shared matching PNG pairs and 29 supplemental
pairs were refreshed. Dimension/alpha verification and canonical packet
verification pass. The unchanged parent remains the verified source-built
fb97140d reference, not the installed application.

## Fresh fix1 observations

The actual Korean imported title was opened at all 12 requested combinations:
840x620, 1280x800 and 1920x1080; 100/150% text; light/dark. Whole source words
stay on one line. The character-rectangle JSON independently finds zero
mid-word breaks and zero single-Hangul orphan lines. All titles fit and remain
unclipped. This replaces the earlier insufficient English-only orphan claim.

The popup option, the minimum/150% Escape return, and the large dark/150%
Escape return were opened at original size. The JSON checks all 24 mode/context
combinations: focus is on the actual opener, its group is closed, the route
remains Appearance and selection is unchanged. Hidden options are disabled,
aria-hidden and excluded from Tab order. Enter is pressed without refocusing
anything and records exactly one opener click, never a hidden option click.
Where the tooltip is open, the first Escape dismisses it and the second closes
the variant group; the group consumes that closing Escape.

The visible differences from the previous implementation are whole-word title
wrapping and correct focus ownership after popup dismissal. No unrelated
product source was changed. Existing narrow Settings sidebar/footer crowding
and popup-over-trigger positioning are not claimed fixed.

The preceding head's 398-frame/3,208-hotspot full inspection remains historical
evidence under history-pre-fix1 and the previous evidence commit. It is not
represented as a fresh full visual sweep of this head. Current fix1's fresh
source-bound captures and targeted 60-PNG fixture are the current proof.

Full universal Q, 200% zoom, +40% authored copy, VoiceOver/IME and interrupted
motion remain Final-wave work under the approved amendment. No independent
QA approval of this new head is claimed.
