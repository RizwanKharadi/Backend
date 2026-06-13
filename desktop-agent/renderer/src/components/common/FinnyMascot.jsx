import React from 'react'
import clsx from 'clsx'
import finnyWelcome from '../../assets/mascot/finny-welcome.png'
import finnyPointing from '../../assets/mascot/finny-pointing.png'
import finnyCelebrate from '../../assets/mascot/finny-celebrate.png'

const POSE_IMAGES = {
  welcome: finnyWelcome,
  pointing: finnyPointing,
  celebrate: finnyCelebrate
}

const FinnyMascot = ({ pose = 'welcome', size = 72, className }) => {
  const src = POSE_IMAGES[pose] || POSE_IMAGES.welcome

  return (
    <img
      src={src}
      alt={`Finny mascot, ${pose} pose`}
      className={clsx('object-contain drop-shadow-md', className)}
      style={{ width: size, height: size }}
    />
  )
}

export default FinnyMascot
