install-chat-hooks:
	npm run build
	rm aismarttalk-react-hooks.tgz || true
	cd ../chatbot-front && rm aismarttalk-react-hooks.tgz || true 
	npm pack --pack-destination . && mv *.tgz aismarttalk-react-hooks.tgz
	cp aismarttalk-react-hooks.tgz ../chatbot-front
	cd ../chatbot-front && npm install aismarttalk-react-hooks.tgz && make stop && make install && make universal-build 
