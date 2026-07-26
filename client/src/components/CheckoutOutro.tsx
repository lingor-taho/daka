interface CheckoutOutroProps {
  employeeName: string;
  checkoutTime: string;
}

export default function CheckoutOutro({ employeeName, checkoutTime }: CheckoutOutroProps) {
  return (
    <main className="checkout-outro">
      <div className="outro-sky-haze outro-sky-haze-one" />
      <div className="outro-sky-haze outro-sky-haze-two" />

      <div className="outro-cloud outro-cloud-one">
        <i />
        <i />
      </div>
      <div className="outro-cloud outro-cloud-two">
        <i />
        <i />
      </div>

      <div className="outro-sun">
        <div className="outro-sun-core" />
      </div>

      <div className="outro-landscape">
        <div className="outro-ridge outro-ridge-back" />
        <div className="outro-ridge outro-ridge-front" />
      </div>

      <div className="outro-message">
        <span>THANK YOU · おつかれさまでした</span>
        <h1>工作一天辛苦了</h1>
        <p>感谢您的付出</p>
      </div>

      <div className="outro-employee">
        <span>{employeeName}</span>
        <strong>退勤时间 {checkoutTime}</strong>
      </div>

      <p className="outro-tomorrow">明早请刷新页面，开启新的一天</p>
    </main>
  );
}
