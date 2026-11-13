UUID = notification-sidebar@bradvrudney.github.io
DEST ?= $(HOME)/.local/share/gnome-shell/extensions/$(UUID)

.PHONY: test schemas install uninstall smoke dev screenshots

test:
	TZ=UTC gjs -m tests/run.js

schemas:
	glib-compile-schemas extension/schemas

install:
	mkdir -p $(DEST)
	cp -r extension/. $(DEST)/
	glib-compile-schemas $(DEST)/schemas

uninstall:
	rm -rf $(DEST)

smoke:
	bash scripts/smoke.sh

dev:
	bash scripts/dev.sh

screenshots:
	bash scripts/screenshots.sh
