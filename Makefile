.PHONY: install-chat-hooks release

install-chat-hooks:
	node scripts/install-chat-hooks.mjs
	$(MAKE) -C ../chatbot-front build universal-build

# Publish only when the operator explicitly invokes this target from main.
BUMP ?= patch
VERSION ?=
DRY_RUN ?= 0
export RELEASE_BUMP = $(BUMP)
export RELEASE_VERSION = $(VERSION)
export RELEASE_DRY_RUN = $(DRY_RUN)

release:
	node scripts/local-release.mjs
