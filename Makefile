.PHONY: install-chat-hooks release

HOOKS_VERSION := $(shell node -p "require('./package.json').version")

install-chat-hooks:
	npm run build
	mkdir -p ../chatbot-front/vendor
	npm pack --ignore-scripts --pack-destination ../chatbot-front/vendor
	cd ../chatbot-front && npm install ./vendor/aismarttalk-react-hooks-$(HOOKS_VERSION).tgz
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
