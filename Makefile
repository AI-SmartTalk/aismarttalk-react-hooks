build_and_pack:
	npm run build && npm pack && mv aismarttalk-react-hooks-1.4.3.tgz ../chatbot-front/aismarttalk-react-hooks-1.4.3.tgz
	cd ../chatbot-front && npm install aismarttalk-react-hooks-1.4.3.tgz
	cd ../chatbot-front && make install