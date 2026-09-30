.PHONY: install-chat-hooks

HOOKS_VERSION := $(shell node -p "require('./package.json').version")

install-chat-hooks:
	npm run build
	mkdir -p ../chatbot-front/vendor
	npm pack --ignore-scripts --pack-destination ../chatbot-front/vendor
	cd ../chatbot-front && npm install ./vendor/aismarttalk-react-hooks-$(HOOKS_VERSION).tgz
	$(MAKE) -C ../chatbot-front build universal-build
