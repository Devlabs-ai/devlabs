import requests
from flask import Flask, jsonify

app = Flask(__name__)
USER_SERVICE_URL = 'http://user-service:5000/user/'

@app.route('/orders/<int:order_id>', methods=['GET'])
def get_order(order_id):
    try:
        user_response = requests.get(USER_SERVICE_URL + '1')
        if user_response.status_code == 200:
            user_data = user_response.json()
            return jsonify({"order_id": order_id, "user": user_data}), 200
        else:
            return jsonify({"error": "User service error"}), 500
    except requests.exceptions.RequestException as e:
        return jsonify({"error": str(e)}), 500

if __name__ == "__main__":
    app.run(host='0.0.0.0', port=8080)